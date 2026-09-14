import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, schedule, stateSchema } from "./model.ts";
function fixture() {
  const s = emptyState();
  const w = crypto.randomUUID(),
    p = crypto.randomUUID();
  s.workspaces.push({ id: w, name: "My own space", color: "#5755d9" });
  s.projects.push({ id: p, name: "Launch", workspaceId: w });
  s.tasks.push(
    {
      id: crypto.randomUUID(),
      title: "First",
      projectId: p,
      minutes: 60,
      priority: "high",
      done: false,
      due: "",
    },
    {
      id: crypto.randomUUID(),
      title: "Second",
      projectId: p,
      minutes: 30,
      priority: "low",
      done: false,
      due: "",
    },
  );
  return s;
}
test("scheduling respects occupied time and never overflows the window", () => {
  const s = fixture();
  s.blocks.push({
    id: crypto.randomUUID(),
    taskId: s.tasks[1].id,
    start: "2026-09-14T09:30:00.000Z",
    end: "2026-09-14T10:00:00.000Z",
  });
  const out = schedule(
    s,
    "2026-09-14T09:00:00.000Z",
    "2026-09-14T11:00:00.000Z",
  );
  assert.equal(out.blocks[1].start, "2026-09-14T10:00:00.000Z");
  assert.equal(out.blocks[1].end, "2026-09-14T11:00:00.000Z");
  assert.equal(s.blocks.length, 1);
  assert.equal(
    schedule(s, "2026-09-14T09:00:00.000Z", "2026-09-14T10:30:00.000Z").blocks
      .length,
    1,
  );
});
test("scheduling is idempotent and excludes completed tasks", () => {
  const s = fixture();
  s.tasks[1].done = true;
  const out = schedule(
    s,
    "2026-09-14T09:00:00.000Z",
    "2026-09-14T17:00:00.000Z",
  );
  assert.equal(out.blocks.length, 1);
  assert.equal(
    schedule(out, "2026-09-14T09:00:00.000Z", "2026-09-14T17:00:00.000Z").blocks
      .length,
    1,
  );
});
test("rejects orphan records and overlapping calendar blocks", () => {
  const s = fixture();
  assert.equal(stateSchema.safeParse(s).success, true);
  s.tasks[0].projectId = crypto.randomUUID();
  assert.equal(stateSchema.safeParse(s).success, false);
  const b = fixture();
  b.blocks.push(
    {
      id: crypto.randomUUID(),
      taskId: b.tasks[0].id,
      start: "2026-09-14T09:00:00.000Z",
      end: "2026-09-14T10:00:00.000Z",
    },
    {
      id: crypto.randomUUID(),
      taskId: b.tasks[1].id,
      start: "2026-09-14T09:30:00.000Z",
      end: "2026-09-14T10:30:00.000Z",
    },
  );
  assert.equal(stateSchema.safeParse(b).success, false);
});
test("due dates precede priority and invalid planning windows fail", () => {
  const s = fixture();
  s.tasks[1].due = "2026-09-15";
  const out = schedule(
    s,
    "2026-09-14T09:00:00.000Z",
    "2026-09-14T09:30:00.000Z",
  );
  assert.equal(out.blocks[0].taskId, s.tasks[1].id);
  assert.throws(() => schedule(s, "invalid", "invalid"));
  assert.throws(() =>
    schedule(s, "2026-09-14T09:00:00.000Z", "2026-09-16T09:00:00.000Z"),
  );
});
