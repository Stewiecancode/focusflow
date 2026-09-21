import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "./database.ts";
import {
  createReminderWorker,
  defaultPreferences,
  initReminders,
  planReminders,
  DeliveryError,
  cronAuthorized,
  type Sender,
} from "./reminders.ts";
import { emptyState, schedule, stateSchema } from "./model.ts";
const now = Date.parse("2026-10-01T09:00:00Z");
const meeting = {
  id: crypto.randomUUID(),
  title: "Design review",
  location: "Room A",
  start: new Date(now + 600000).toISOString(),
  end: new Date(now + 2400000).toISOString(),
};
test("meeting reminders are timezone-aware, default to ten minutes and start, and scheduling avoids meetings", () => {
  const state = { ...emptyState(), meetings: [meeting] };
  const reminders = planReminders("user", state, {
    ...defaultPreferences,
    timeZone: "Africa/Johannesburg",
  });
  assert.deepEqual(
    reminders.map((r) => r.due),
    [now, now + 600000],
  );
  assert.match(reminders[0].body, /11:10/);
  assert.notEqual(reminders[0].id, reminders[1].id);
  assert.notEqual(
    planReminders("other", state, defaultPreferences)[0].id,
    reminders[0].id,
  );
  const w = { id: crypto.randomUUID(), name: "Work", color: "#5755d9" };
  const p = { id: crypto.randomUUID(), name: "Project", workspaceId: w.id };
  const t = {
    id: crypto.randomUUID(),
    title: "Task",
    projectId: p.id,
    minutes: 25,
    priority: "high" as const,
    done: false,
    due: "",
  };
  const filled = { ...state, workspaces: [w], projects: [p], tasks: [t] };
  const result = schedule(
    filled,
    new Date(now).toISOString(),
    new Date(now + 7200000).toISOString(),
  );
  assert.equal(result.blocks[0].start, meeting.end);
  assert.equal(
    stateSchema.safeParse({
      ...filled,
      blocks: [
        {
          id: crypto.randomUUID(),
          taskId: t.id,
          start: meeting.start,
          end: meeting.end,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    planReminders(
      "user",
      {
        ...filled,
        tasks: [{ ...t, done: true }],
        blocks: [
          {
            id: crypto.randomUUID(),
            taskId: t.id,
            start: meeting.start,
            end: meeting.end,
          },
        ],
      },
      defaultPreferences,
    ).length,
    2,
  );
});
test("durable inbox and channel leases deduplicate ticks, retry transient failures and stop deleted events", async () => {
  const old = process.env.DATABASE_PATH;
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
  const db = await createDatabase();
  if (old === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = old;
  if (oldUrl !== undefined) process.env.DATABASE_URL = oldUrl;
  await initReminders(db);
  const state = { ...emptyState(), meetings: [meeting] };
  await db
    .prepare(
      "INSERT INTO users(id,name,email,password,state) VALUES(?,?,?,?,?)",
    )
    .run("a", "A", "a@example.test", "unused", JSON.stringify(state));
  await db
    .prepare(
      "INSERT INTO reminder_preferences(user_id,settings,enabled_since) VALUES(?,?,?)",
    )
    .run(
      "a",
      JSON.stringify({ ...defaultPreferences, email: true, push: true }),
      now - 1,
    );
  await db
    .prepare(
      "INSERT INTO push_devices(token,user_id,session_token,expires) VALUES(?,?,?,?)",
    )
    .run("ExpoPushToken[test-device]", "a", "session", now + 86400000);
  const calls: string[] = [];
  const sender: Sender = async (channel, destination, r) => {
    calls.push(`${channel}:${destination}:${r.id}`);
    return channel === "push" ? { receiptId: "receipt" } : {};
  };
  const config = () => ({
    emailReady: true,
    pushReady: true,
    schedulerReady: true,
  });
  await createReminderWorker(db, sender, config).tick(now);
  // A fresh worker simulates process restart; persisted receipts stop duplicates.
  await createReminderWorker(db, sender, config).tick(now + 1000);
  assert.equal(calls.length, 2);
  assert.equal(
    (await db.prepare("SELECT id FROM reminder_inbox WHERE user_id=?").all("a"))
      .length,
    1,
  );
  await createReminderWorker(db, sender, config).tick(now + 600000);
  assert.equal(calls.length, 4);
  assert.equal(
    (await db.prepare("SELECT id FROM reminder_inbox WHERE user_id=?").all("a"))
      .length,
    2,
  );
  const moved = {
    ...meeting,
    start: new Date(now + 1200000).toISOString(),
    end: new Date(now + 3000000).toISOString(),
  };
  await db
    .prepare("UPDATE users SET state=? WHERE id=?")
    .run(JSON.stringify({ ...state, meetings: [moved] }), "a");
  let failures = 0;
  const retry = createReminderWorker(
    db,
    async () => {
      failures++;
      throw new DeliveryError("Temporary");
    },
    config,
  );
  await retry.tick(now + 600000);
  assert.equal(failures, 2);
  await retry.tick(now + 610000);
  assert.equal(failures, 2);
  await db
    .prepare("UPDATE users SET state=? WHERE id=?")
    .run(JSON.stringify(emptyState()), "a");
  await retry.tick(now + 720000);
  assert.equal(failures, 2);
  // No stale messages are sent when a server wakes long after a meeting ends.
  await db
    .prepare("UPDATE users SET state=? WHERE id=?")
    .run(JSON.stringify(state), "a");
  await createReminderWorker(db, sender, config).tick(now + 86400000);
  assert.equal(calls.length, 4);
});
test("cron route secret must be configured and match exactly", () => {
  const old = process.env.REMINDER_CRON_SECRET;
  process.env.REMINDER_CRON_SECRET = "x".repeat(32);
  assert.equal(cronAuthorized(undefined), false);
  assert.equal(cronAuthorized("Bearer bad"), false);
  assert.equal(cronAuthorized(`Bearer ${"x".repeat(32)}`), true);
  if (old === undefined) delete process.env.REMINDER_CRON_SECRET;
  else process.env.REMINDER_CRON_SECRET = old;
});
