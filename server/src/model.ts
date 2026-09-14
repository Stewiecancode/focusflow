import { z } from "zod";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(120);
export const stateSchema = z
  .object({
    workspaces: z.array(
      z.object({ id, name, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
    ),
    projects: z.array(z.object({ id, name, workspaceId: id })),
    tasks: z.array(
      z.object({
        id,
        title: name,
        projectId: id,
        minutes: z.number().int().min(5).max(480),
        priority: z.enum(["high", "medium", "low"]),
        done: z.boolean(),
        due: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .or(z.literal("")),
      }),
    ),
    blocks: z.array(
      z.object({
        id,
        taskId: id,
        start: z.string().datetime(),
        end: z.string().datetime(),
      }),
    ),
    sessions: z.array(
      z.object({
        id,
        taskId: id,
        minutes: z.number().int().min(1).max(480),
        completedAt: z.string().datetime(),
      }),
    ),
  })
  .superRefine((s, ctx) => {
    const all = [
      ...s.workspaces,
      ...s.projects,
      ...s.tasks,
      ...s.blocks,
      ...s.sessions,
    ].map((x) => x.id);
    const invalid =
      new Set(all).size !== all.length ||
      s.projects.some(
        (p) => !s.workspaces.some((w) => w.id === p.workspaceId),
      ) ||
      s.tasks.some((t) => !s.projects.some((p) => p.id === t.projectId)) ||
      [...s.blocks, ...s.sessions].some(
        (b) => !s.tasks.some((t) => t.id === b.taskId),
      );
    if (invalid)
      ctx.addIssue({
        code: "custom",
        message: "Invalid or duplicate relationship",
      });
    const blocks = [...s.blocks].sort((a, b) => a.start.localeCompare(b.start));
    if (
      blocks.some(
        (b, i) =>
          Date.parse(b.end) <= Date.parse(b.start) ||
          (i > 0 && Date.parse(blocks[i - 1].end) > Date.parse(b.start)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Calendar blocks must have a positive duration and cannot overlap",
      });
  });
export type State = z.infer<typeof stateSchema>;
export const emptyState = (): State => ({
  workspaces: [],
  projects: [],
  tasks: [],
  blocks: [],
  sessions: [],
});
export function schedule(state: State, start: string, end: string) {
  const result = structuredClone(state);
  let cursor = Date.parse(start);
  const limit = Date.parse(end);
  if (
    !Number.isFinite(cursor) ||
    !Number.isFinite(limit) ||
    limit <= cursor ||
    limit - cursor > 86400000
  )
    throw new Error("Choose a planning window of up to 24 hours");
  const rank = { high: 0, medium: 1, low: 2 };
  const pending = state.tasks
    .filter((t) => !t.done && !state.blocks.some((b) => b.taskId === t.id))
    .sort(
      (a, b) =>
        (a.due || "9999").localeCompare(b.due || "9999") ||
        rank[a.priority] - rank[b.priority],
    );
  for (const task of pending) {
    let candidate = cursor;
    const duration = task.minutes * 60000;
    for (const block of [...result.blocks].sort((a, b) =>
      a.start.localeCompare(b.start),
    )) {
      if (candidate + duration <= Date.parse(block.start)) break;
      if (
        candidate < Date.parse(block.end) &&
        candidate + duration > Date.parse(block.start)
      )
        candidate = Date.parse(block.end);
    }
    if (candidate + duration <= limit) {
      result.blocks.push({
        id: crypto.randomUUID(),
        taskId: task.id,
        start: new Date(candidate).toISOString(),
        end: new Date(candidate + duration).toISOString(),
      });
      cursor = candidate + duration;
    }
  }
  return result;
}
