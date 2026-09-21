import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { createDatabase } from "./database.ts";
import type { State } from "./model.ts";
type DB = Awaited<ReturnType<typeof createDatabase>>;
export const preferencesSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
  leadMinutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
  ]),
  atStart: z.boolean(),
  timeZone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone"),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  inApp: true,
  email: false,
  push: false,
  leadMinutes: 10,
  atStart: true,
  timeZone: "UTC",
};
type ReminderUser = {
  id: string;
  email: string;
  state: string;
  settings: string;
  enabled_since: number;
};
export type Reminder = {
  id: string;
  eventId: string;
  kind: "meeting" | "block";
  title: string;
  body: string;
  start: string;
  end: string;
  due: number;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function planReminders(
  userId: string,
  state: State,
  prefs: Preferences,
): Reminder[] {
  const events = [
    ...state.blocks
      .filter((b) => state.tasks.some((t) => t.id === b.taskId && !t.done))
      .map((b) => ({
        ...b,
        kind: "block" as const,
        title: state.tasks.find((t) => t.id === b.taskId)!.title,
      })),
    ...(state.meetings || []).map((m) => ({ ...m, kind: "meeting" as const })),
  ];
  const offsets = [
    ...(prefs.leadMinutes > 0 ? [prefs.leadMinutes] : []),
    ...(prefs.atStart ? [0] : []),
  ];
  return events.flatMap((e) =>
    offsets.map((offset) => {
      const title = `${e.kind === "meeting" ? "Meeting" : "Time block"} ${offset ? `in ${offset} minutes` : "starting now"}`;
      const when = new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: prefs.timeZone,
      }).format(new Date(e.start));
      return {
        id: hash(`${userId}:${e.kind}:${e.id}:${e.start}:${offset}`),
        eventId: e.id,
        kind: e.kind,
        title,
        body: `${e.title} · ${when} (${prefs.timeZone})`,
        start: e.start,
        end: e.end,
        due: Date.parse(e.start) - offset * 60000,
      };
    }),
  );
}
export async function initReminders(db: DB) {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS reminder_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,settings TEXT NOT NULL,enabled_since BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS push_devices(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_token TEXT NOT NULL,expires BIGINT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS reminder_inbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,due_at BIGINT NOT NULL,read_at BIGINT NOT NULL DEFAULT 0,visible INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS reminder_inbox_user ON reminder_inbox(user_id,due_at)",
    "CREATE TABLE IF NOT EXISTS reminder_deliveries(id TEXT PRIMARY KEY,notification_id TEXT NOT NULL REFERENCES reminder_inbox(id) ON DELETE CASCADE,user_id TEXT NOT NULL,channel TEXT NOT NULL,destination TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt BIGINT NOT NULL,receipt_id TEXT,last_error TEXT)",
  ])
    await db.prepare(sql).run();
}
export async function getPreferences(db: DB, userId: string) {
  await db
    .prepare(
      "INSERT INTO reminder_preferences(user_id,settings,enabled_since) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING",
    )
    .run(userId, JSON.stringify(defaultPreferences), Date.now());
  const row = await db
    .prepare("SELECT settings FROM reminder_preferences WHERE user_id=?")
    .get(userId);
  return preferencesSchema.parse(JSON.parse(String(row!.settings)));
}
export function deliveryConfiguration() {
  return {
    emailReady: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    pushReady: process.env.PUSH_ENABLED === "true",
    schedulerReady:
      (process.env.REMINDER_CRON_SECRET?.length || 0) >= 32 ||
      process.env.REMINDER_ALWAYS_ON === "true",
  };
}
export function cronAuthorized(value: string | undefined) {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret || secret.length < 32 || !value) return false;
  const actual = Buffer.from(value),
    expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
type SendResult = { receiptId?: string };
export type Sender = (
  channel: "email" | "push",
  destination: string,
  reminder: Reminder,
  id: string,
) => Promise<SendResult>;
export class DeliveryError extends Error {
  permanent: boolean;
  constructor(message: string, permanent = false) {
    super(message);
    this.permanent = permanent;
  }
}
export async function sendReminder(
  channel: "email" | "push",
  destination: string,
  r: Reminder,
  id: string,
): Promise<SendResult> {
  if (channel === "email") {
    if (!deliveryConfiguration().emailReady)
      throw new DeliveryError("Email sender is not configured");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [destination],
        subject: r.title,
        text: `${r.title}\n\n${r.body}\n\nOpen FocusFlow to view your calendar. Change reminder preferences in Notifications.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new DeliveryError(
        `Email provider HTTP ${response.status}`,
        response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status),
      );
    const result = await response.json();
    if (!result.id)
      throw new DeliveryError("Email provider did not accept the message");
    return {};
  }
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      to: destination,
      title: r.title,
      body: r.body,
      sound: "default",
      channelId: "reminders",
      ttl: Math.max(
        1,
        Math.min(900, Math.floor((Date.parse(r.end) - Date.now()) / 1000)),
      ),
      data: {
        notificationId: r.id,
        eventId: r.eventId,
        kind: r.kind,
        start: r.start,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new DeliveryError(
      `Push provider HTTP ${response.status}`,
      response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429,
    );
  const json = await response.json();
  const ticket = json.data;
  if (ticket?.status !== "ok")
    throw new DeliveryError(
      ticket?.details?.error === "DeviceNotRegistered"
        ? "DeviceNotRegistered"
        : "Push provider rejected the notification",
      true,
    );
  if (!ticket.id)
    throw new DeliveryError("Push provider did not return a receipt");
  return { receiptId: ticket.id };
}
export function createReminderWorker(
  db: DB,
  sender: Sender = sendReminder,
  configuration = deliveryConfiguration,
) {
  let running = false;
  async function tick(now = Date.now(), onlyUser?: string, inboxOnly = false) {
    if (running) return;
    running = true;
    let sends = 0;
    const started = Date.now();
    try {
      const users = (await db
        .prepare(
          `SELECT users.id,users.email,users.state,reminder_preferences.settings,reminder_preferences.enabled_since FROM users JOIN reminder_preferences ON users.id=reminder_preferences.user_id${onlyUser ? " WHERE users.id=?" : ""}`,
        )
        .all(...(onlyUser ? [onlyUser] : []))) as unknown as ReminderUser[];
      for (const user of users) {
        const prefs = preferencesSchema.parse(JSON.parse(user.settings));
        const state = JSON.parse(user.state) as State;
        const planned = planReminders(user.id, state, prefs);
        if (!inboxOnly) {
          const valid = new Set(planned.map((r) => r.id));
          const pending = await db
            .prepare(
              "SELECT id,notification_id,channel FROM reminder_deliveries WHERE user_id=? AND status='pending'",
            )
            .all(user.id);
          for (const job of pending)
            if (
              !valid.has(String(job.notification_id)) ||
              !prefs[job.channel as "email" | "push"]
            )
              await db
                .prepare(
                  "UPDATE reminder_deliveries SET status='cancelled' WHERE id=? AND status='pending'",
                )
                .run(String(job.id));
        }
        for (const r of planned) {
          if (
            r.due > now ||
            r.due < Number(user.enabled_since) ||
            r.due < now - 7 * 86400000
          )
            continue;
          await db
            .prepare(
              "INSERT INTO reminder_inbox(id,user_id,payload,due_at,visible) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            )
            .run(r.id, user.id, JSON.stringify(r), r.due, prefs.inApp ? 1 : 0);
          // Never send an outdated reminder after the event has finished, or
          // more than 15 minutes late. Inbox entries remain available offline.
          if (
            inboxOnly ||
            now - r.due > 900000 ||
            now >= Date.parse(r.end) ||
            (r.due < Date.parse(r.start) && now >= Date.parse(r.start))
          )
            continue;
          const targets: { channel: "email" | "push"; destination: string }[] =
            [];
          if (prefs.email && configuration().emailReady)
            targets.push({ channel: "email", destination: user.email });
          if (prefs.push && configuration().pushReady) {
            const devices = await db
              .prepare(
                "SELECT token FROM push_devices WHERE user_id=? AND expires>?",
              )
              .all(user.id, now);
            targets.push(
              ...devices.map((d) => ({
                channel: "push" as const,
                destination: String(d.token),
              })),
            );
          }
          for (const t of targets) {
            if (sends >= 50 || Date.now() - started > 25000) return;
            const id = hash(`${r.id}:${t.channel}:${t.destination}`);
            await db
              .prepare(
                "INSERT INTO reminder_deliveries(id,notification_id,user_id,channel,destination,status,next_attempt) VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING",
              )
              .run(id, r.id, user.id, t.channel, t.destination, now);
            const claim = await db
              .prepare(
                "UPDATE reminder_deliveries SET status='sending',attempts=attempts+1,next_attempt=? WHERE id=? AND attempts<5 AND next_attempt<=? AND status IN ('pending','sending')",
              )
              .run(now + 120000, id, now);
            if (!claim.changes) continue;
            // Re-read state and preferences after acquiring the lease. Cancel
            // edits, deletions, completions and opt-outs before contacting providers.
            const fresh = await db
              .prepare(
                "SELECT state,settings FROM users JOIN reminder_preferences ON users.id=reminder_preferences.user_id WHERE users.id=?",
              )
              .get(user.id);
            const latest = preferencesSchema.parse(
              JSON.parse(String(fresh!.settings)),
            );
            const stillDue = planReminders(
              user.id,
              JSON.parse(String(fresh!.state)),
              latest,
            ).some((x) => x.id === r.id);
            const device =
              t.channel === "push"
                ? await db
                    .prepare(
                      "SELECT token FROM push_devices WHERE token=? AND user_id=? AND expires>?",
                    )
                    .get(t.destination, user.id, now)
                : true;
            if (!stillDue || !latest[t.channel] || !device) {
              await db
                .prepare(
                  "UPDATE reminder_deliveries SET status='cancelled' WHERE id=?",
                )
                .run(id);
              continue;
            }
            try {
              sends++;
              const result = await sender(t.channel, t.destination, r, id);
              await db
                .prepare(
                  "UPDATE reminder_deliveries SET status='accepted',receipt_id=?,next_attempt=?,last_error=NULL WHERE id=?",
                )
                .run(result.receiptId || null, now + 15 * 60000, id);
            } catch (e) {
              const row = await db
                .prepare("SELECT attempts FROM reminder_deliveries WHERE id=?")
                .get(id);
              const permanent = e instanceof DeliveryError && e.permanent;
              await db
                .prepare(
                  "UPDATE reminder_deliveries SET status=?,next_attempt=?,last_error=? WHERE id=?",
                )
                .run(
                  permanent || Number(row!.attempts) >= 5
                    ? "failed"
                    : "pending",
                  now + Math.min(300000, 2 ** Number(row!.attempts) * 30000),
                  e instanceof DeliveryError
                    ? e.message
                    : "Delivery temporarily unavailable",
                  id,
                );
              if (
                e instanceof DeliveryError &&
                e.message === "DeviceNotRegistered"
              )
                await db
                  .prepare("DELETE FROM push_devices WHERE token=?")
                  .run(t.destination);
            }
          }
        }
      }
      await db.prepare("DELETE FROM push_devices WHERE expires<=?").run(now);
      await db
        .prepare("DELETE FROM reminder_inbox WHERE due_at<?")
        .run(now - 30 * 86400000);
    } finally {
      running = false;
    }
  }
  async function receipts(now = Date.now()) {
    if (!configuration().pushReady) return;
    const rows = await db
      .prepare(
        "SELECT id,receipt_id,destination FROM reminder_deliveries WHERE status='accepted' AND receipt_id IS NOT NULL AND next_attempt<=? LIMIT 100",
      )
      .all(now);
    if (!rows.length) return;
    const response = await fetch(
      "https://exp.host/--/api/v2/push/getReceipts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({ ids: rows.map((r) => r.receipt_id) }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error("Push receipt check unavailable");
    const json = await response.json();
    for (const row of rows) {
      const receipt = json.data?.[String(row.receipt_id)];
      if (!receipt) {
        await db
          .prepare("UPDATE reminder_deliveries SET next_attempt=? WHERE id=?")
          .run(now + 3600000, String(row.id));
        continue;
      }
      await db
        .prepare(
          "UPDATE reminder_deliveries SET status=?,last_error=? WHERE id=?",
        )
        .run(
          receipt.status === "ok" ? "handed_off" : "failed",
          receipt.status === "ok" ? null : "Push receipt reported an error",
          String(row.id),
        );
      if (receipt.details?.error === "DeviceNotRegistered")
        await db
          .prepare("DELETE FROM push_devices WHERE token=?")
          .run(String(row.destination));
    }
  }
  return { tick, receipts };
}
