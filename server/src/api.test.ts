import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("account isolation, optimistic locking, validation and logout", async () => {
  const child = spawn(process.execPath, ["src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_PATH: ":memory:",
      PORT: "43189",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("API did not start")), 10000).unref(),
      ),
    ]);
    const request = async (
      route: string,
      method = "GET",
      body?: unknown,
      cookie = "",
    ) => {
      const res = await fetch("http://127.0.0.1:43189/api" + route, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: res.status,
        data: await res.json(),
        cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
      };
    };
    assert.equal((await request("/state")).status, 401);
    const a = await request("/auth/register", "POST", {
      name: "Alpha",
      email: "alpha@example.test",
      password: "testing-password-123",
    });
    assert.equal(a.status, 200);
    assert.ok(a.cookie);
    const w = { id: crypto.randomUUID(), name: "Any name", color: "#abcdef" };
    const state = {
      workspaces: [w],
      projects: [],
      tasks: [],
      blocks: [],
      sessions: [],
    };
    assert.equal(
      (await request("/state", "PUT", { state, revision: 0 }, a.cookie)).status,
      200,
    );
    assert.equal(
      (await request("/state", "PUT", { state, revision: 0 }, a.cookie)).status,
      409,
    );
    const b = await request("/auth/register", "POST", {
      name: "Beta",
      email: "beta@example.test",
      password: "testing-password-456",
    });
    assert.equal(
      (await request("/state", "GET", undefined, b.cookie)).data.state
        .workspaces.length,
      0,
    );
    assert.equal(
      (await request("/state", "GET", undefined, a.cookie)).data.state
        .workspaces[0].name,
      "Any name",
    );
    assert.equal(
      (
        await request(
          "/state",
          "PUT",
          {
            state: {
              ...state,
              projects: [
                {
                  id: crypto.randomUUID(),
                  name: "Orphan",
                  workspaceId: crypto.randomUUID(),
                },
              ],
            },
            revision: 1,
          },
          a.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "alpha@example.test",
          password: "wrong-password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "alpha@example.test",
          password: "testing-password-123",
        })
      ).status,
      200,
    );
    assert.equal((await request("/logout", "POST", {}, a.cookie)).status, 200);
    assert.equal(
      (await request("/state", "GET", undefined, a.cookie)).status,
      401,
    );
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
