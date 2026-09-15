import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("production proxy origin, secure cookies, JSON validation, and persistence across restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "focusflow-test-"));
  const start = async () => {
    const child = spawn(process.execPath, ["src/index.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "43190",
        DATABASE_PATH: path.join(directory, "test.sqlite"),
        APP_ORIGINS: "https://focusflow.example",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Startup timeout")), 10000).unref(),
      ),
    ]);
    return child;
  };
  let child = await start();
  const request = (route: string, options: RequestInit = {}) =>
    fetch("http://127.0.0.1:43190/api" + route, options);
  const payload = JSON.stringify({
    name: "Production test",
    email: "production@example.test",
    password: "testing-production-123",
  });
  try {
    const rejected = await request("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: payload,
    });
    assert.equal(rejected.status, 403);
    const registered = await request("/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://focusflow.example",
      },
      body: payload,
    });
    assert.equal(registered.status, 200);
    const setCookie = registered.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];
    const headers = {
      "Content-Type": "application/json",
      Origin: "https://focusflow.example",
      Cookie: cookie,
    };
    const state = {
      workspaces: [
        {
          id: crypto.randomUUID(),
          name: "Saved across restart",
          color: "#abcdef",
        },
      ],
      projects: [],
      tasks: [],
      blocks: [],
      sessions: [],
    };
    assert.equal(
      (
        await request("/state", {
          method: "PUT",
          headers,
          body: JSON.stringify({ state, revision: 0 }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await request("/state", { method: "PUT", headers, body: "{" })).status,
      400,
    );
    assert.equal(
      (
        await request("/state", {
          method: "PUT",
          headers: { ...headers, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
      415,
    );
    child.kill();
    await once(child, "exit");
    child = await start();
    const persisted = await request("/state", { headers: { Cookie: cookie } });
    assert.equal(persisted.status, 200);
    assert.equal(
      (await persisted.json()).state.workspaces[0].name,
      "Saved across restart",
    );
    assert.equal((await request("/health")).status, 200);
  } finally {
    child.kill();
    await once(child, "exit");
    await rm(directory, { recursive: true, force: true });
  }
});
