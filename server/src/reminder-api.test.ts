import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
test("reminder endpoints enforce ownership, preserve legacy meetings, and remove device access on logout", async () => {
  const child = spawn(process.execPath, ["src/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "43204",
      HOST: "127.0.0.1",
      DATABASE_URL: "",
      DATABASE_PATH: ":memory:",
      REMINDER_CRON_SECRET: "s".repeat(32),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Server timeout")), 12000).unref(),
      ),
    ]);
    const call = async (
      path: string,
      method = "GET",
      body?: unknown,
      token = "",
    ) => {
      const res = await fetch("http://127.0.0.1:43204/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-FocusFlow-Client": "native",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json() };
    };
    assert.equal((await call("/reminders")).status, 401);
    const a = (
      await call("/auth/register", "POST", {
        email: "reminder-a@example.test",
        name: "A",
        password: "reminder-password-123",
      })
    ).data.sessionToken;
    const b = (
      await call("/auth/register", "POST", {
        email: "reminder-b@example.test",
        name: "B",
        password: "reminder-password-123",
      })
    ).data.sessionToken;
    const prefs = (await call("/reminders", "GET", undefined, a)).data
      .preferences;
    assert.equal(prefs.leadMinutes, 10);
    assert.equal(prefs.atStart, true);
    assert.equal(
      (
        await call(
          "/reminders/preferences",
          "PUT",
          { ...prefs, timeZone: "Made/Up" },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (await call("/reminders/devices", "POST", { token: "bad" }, a)).status,
      400,
    );
    const device = "ExpoPushToken[test-owned-device]";
    await call("/reminders/devices", "POST", { token: device }, a);
    assert.equal(
      (await call("/reminders", "GET", undefined, a)).data.deviceCount,
      1,
    );
    await call("/reminders/devices", "DELETE", { token: device }, b);
    assert.equal(
      (await call("/reminders", "GET", undefined, a)).data.deviceCount,
      1,
    );
    const snapshot = (await call("/state", "GET", undefined, a)).data;
    const start = new Date(Date.now() + 50).toISOString(),
      end = new Date(Date.now() + 3600000).toISOString();
    const meeting = {
      id: crypto.randomUUID(),
      title: "Starting meeting",
      start,
      end,
      location: "",
    };
    assert.equal(
      (
        await call(
          "/state",
          "PUT",
          { state: { ...snapshot.state, meetings: [meeting] }, revision: 0 },
          a,
        )
      ).status,
      200,
    );
    // Omission by an old client does not erase the meeting.
    assert.equal(
      (await call("/state", "PUT", { state: snapshot.state, revision: 1 }, a))
        .status,
      200,
    );
    assert.equal(
      (await call("/state", "GET", undefined, a)).data.state.meetings.length,
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const inbox = (await call("/reminders", "GET", undefined, a)).data;
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.unread, 1);
    await call("/reminders/read", "POST", { id: inbox.items[0].id }, b);
    assert.equal(
      (await call("/reminders", "GET", undefined, a)).data.unread,
      1,
    );
    assert.equal(
      (await call("/reminders", "GET", undefined, b)).data.items.length,
      0,
    );
    await call("/reminders/read", "POST", { id: inbox.items[0].id }, a);
    assert.equal(
      (await call("/reminders", "GET", undefined, a)).data.unread,
      0,
    );
    assert.equal(
      (await call("/internal/reminders/run", "POST", {}, a)).status,
      401,
    );
    assert.equal(
      (await call("/internal/reminders/run", "POST", {}, "s".repeat(32)))
        .status,
      200,
    );
    await call("/logout", "POST", {}, a);
    const again = (
      await call("/auth/login", "POST", {
        email: "reminder-a@example.test",
        password: "reminder-password-123",
      })
    ).data.sessionToken;
    assert.equal(
      (await call("/reminders", "GET", undefined, again)).data.deviceCount,
      0,
    );
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
