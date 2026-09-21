import express from "express";
import { createDatabase } from "./database.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import "dotenv/config";
import { z } from "zod";
import { emptyState, stateSchema, schedule } from "./model.ts";
import {
  initReminders,
  createReminderWorker,
  getPreferences,
  preferencesSchema,
  deliveryConfiguration,
  cronAuthorized,
} from "./reminders.ts";
const derive = promisify(scrypt);
const production = process.env.NODE_ENV === "production";
const allowedOrigins = new Set(
  (process.env.APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (production && !allowedOrigins.size) {
  throw new Error(
    "Production requires APP_ORIGINS with the exact frontend HTTPS origin",
  );
}
for (const origin of allowedOrigins) {
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    (production && parsed.protocol !== "https:")
  ) {
    throw new Error(
      "APP_ORIGINS must contain exact origins, using HTTPS in production",
    );
  }
}
const db = await createDatabase();
await initReminders(db);
const reminderWorker = createReminderWorker(db);
const app = express();
app.disable("x-powered-by");
// Render is the immediate trusted reverse proxy. Do not trust arbitrary chains.
if (production) app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (!req.is("application/json"))
      return res.status(415).json({ error: "Use application/json" });
    const origin = req.headers.origin;
    if (origin) {
      let permitted = allowedOrigins.has(origin);
      if (!production) {
        try {
          permitted ||=
            new URL(origin).origin === `${req.protocol}://${req.headers.host}`;
        } catch {
          /* Invalid origins are rejected. */
        }
      }
      if (!permitted)
        return res.status(403).json({ error: "Origin not allowed" });
    }
  }
  next();
});
type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  state: string;
  revision: number;
};
app.post("/api/internal/reminders/run", async (req, res) => {
  if (!cronAuthorized(req.headers.authorization))
    return res.status(401).json({ error: "Unauthorized" });
  await reminderWorker.tick();
  await reminderWorker.receipts();
  res.json({ ok: true });
});
const token = (req: express.Request) => {
  const bearer = req.headers.authorization?.match(
    /^Bearer ([a-f0-9]{64})$/,
  )?.[1];
  const raw =
    bearer ||
    req.headers.cookie
      ?.split(";")
      .find((c) => c.trim().startsWith("focusflow="))
      ?.trim()
      .slice(10) ||
    "";
  return createHash("sha256").update(raw).digest("hex");
};
app.use("/api", async (req, res, next) => {
  const user = (await db
    .prepare(
      "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE token=? AND expires>?",
    )
    .get(token(req), Date.now())) as User | undefined;
  res.locals.user = user;
  next();
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});
const attempts = new Map<string, { count: number; reset: number }>();
app.post("/api/auth/:action", async (req, res) => {
  if (!["register", "login"].includes(String(req.params.action)))
    return res.sendStatus(404);
  const key = req.ip || "local";
  const now = Date.now();
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const entry = attempts.get(key) || { count: 0, reset: now + 900000 };
  if (entry.reset < now) {
    entry.count = 0;
    entry.reset = now + 900000;
  }
  entry.count++;
  attempts.set(key, entry);
  if (entry.count > 30)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: "Use a valid email and a password of 10–128 characters.",
    });
  const { email, password, name } = parsed.data;
  let user = (await db
    .prepare("SELECT * FROM users WHERE email=?")
    .get(email)) as User | undefined;
  if (req.params.action === "register") {
    if (!name)
      return res.status(400).json({ error: "Please enter your name." });
    if (user)
      return res
        .status(409)
        .json({ error: "Unable to create this account. Try signing in." });
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt, 64)) as Buffer;
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO users(id,name,email,password,state) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        name,
        email,
        salt + ":" + hash.toString("hex"),
        JSON.stringify(emptyState()),
      );
    user = (await db.prepare("SELECT * FROM users WHERE id=?").get(id)) as User;
  } else {
    const [salt, hash] = (user?.password || "dummy:" + "0".repeat(128)).split(
      ":",
    );
    const actual = (await derive(password, salt, 64)) as Buffer;
    if (!user || !timingSafeEqual(actual, Buffer.from(hash, "hex")))
      return res.status(401).json({ error: "Email or password is incorrect." });
  }
  await db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const raw = randomBytes(32).toString("hex");
  await db
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(
      createHash("sha256").update(raw).digest("hex"),
      user.id,
      Date.now() + 604800000,
    );
  res.cookie("focusflow", raw, {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    maxAge: 604800000,
    path: "/",
  });
  res.json({
    name: user.name,
    ...(req.headers["x-focusflow-client"] === "native"
      ? { sessionToken: raw }
      : {}),
  });
});
app.get("/api/health", async (_req, res) => {
  await db.prepare("SELECT 1").get();
  res.json({ ok: true });
});
app.use("/api", (_req, res, next) =>
  res.locals.user ? next() : res.status(401).json({ error: "Please sign in." }),
);
app.post("/api/logout", async (req, res) => {
  await db
    .prepare("DELETE FROM push_devices WHERE session_token=?")
    .run(token(req));
  await db.prepare("DELETE FROM sessions WHERE token=?").run(token(req));
  res.clearCookie("focusflow", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/state", (_req, res) => {
  const u = res.locals.user as User;
  res.json({
    name: u.name,
    state: JSON.parse(u.state),
    revision: u.revision,
    features: { reminders: true },
  });
});
app.get("/api/reminders", async (_req, res) => {
  const u = res.locals.user as User;
  const preferences = await getPreferences(db, u.id);
  await reminderWorker.tick(Date.now(), u.id, true);
  const rows = await db
    .prepare(
      "SELECT id,payload,read_at FROM reminder_inbox WHERE user_id=? AND visible=1 ORDER BY due_at DESC LIMIT 100",
    )
    .all(u.id);
  const count = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM reminder_inbox WHERE user_id=? AND visible=1 AND read_at=0",
    )
    .get(u.id);
  const devices = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM push_devices WHERE user_id=? AND expires>?",
    )
    .get(u.id, Date.now());
  const deliveries = await db
    .prepare(
      "SELECT notification_id,channel,status FROM reminder_deliveries WHERE user_id=?",
    )
    .all(u.id);
  res.json({
    preferences,
    email: u.email,
    configuration: deliveryConfiguration(),
    deviceCount: Number(devices!.count),
    unread: Number(count!.count),
    items: rows.map((r) => ({
      ...JSON.parse(String(r.payload)),
      read: !!Number(r.read_at),
      deliveries: deliveries
        .filter((d) => d.notification_id === r.id)
        .map((d) => ({ channel: d.channel, status: d.status })),
    })),
  });
});
app.put("/api/reminders/preferences", async (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0].message });
  const u = res.locals.user as User;
  const existing = await getPreferences(db, u.id);
  // A new opt-in starts now; editing a timezone does not resend old messages.
  const newOptIn =
    (!existing.email && parsed.data.email) ||
    (!existing.push && parsed.data.push);
  await db
    .prepare("UPDATE reminder_preferences SET settings=? WHERE user_id=?")
    .run(JSON.stringify(parsed.data), u.id);
  if (newOptIn)
    await db
      .prepare(
        "UPDATE reminder_preferences SET enabled_since=? WHERE user_id=?",
      )
      .run(Date.now(), u.id);
  res.json({ ok: true });
});
app.post("/api/reminders/read", async (req, res) => {
  const parsed = z
    .object({
      id: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid notification" });
  const userId = (res.locals.user as User).id;
  if (parsed.data.id)
    await db
      .prepare("UPDATE reminder_inbox SET read_at=? WHERE id=? AND user_id=?")
      .run(Date.now(), parsed.data.id, userId);
  else
    await db
      .prepare(
        "UPDATE reminder_inbox SET read_at=? WHERE user_id=? AND read_at=0",
      )
      .run(Date.now(), userId);
  res.json({ ok: true });
});
const deviceSchema = z.object({
  token: z
    .string()
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)
    .max(250),
});
app.post("/api/reminders/devices", async (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid Expo push token" });
  const session = await db
    .prepare("SELECT expires FROM sessions WHERE token=?")
    .get(token(req));
  await db
    .prepare(
      "INSERT INTO push_devices(token,user_id,session_token,expires) VALUES(?,?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_token=excluded.session_token,expires=excluded.expires",
    )
    .run(
      parsed.data.token,
      (res.locals.user as User).id,
      token(req),
      Number(session!.expires),
    );
  res.json({ ok: true });
});
app.delete("/api/reminders/devices", async (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid Expo push token" });
  await db
    .prepare("DELETE FROM push_devices WHERE token=? AND user_id=?")
    .run(parsed.data.token, (res.locals.user as User).id);
  res.json({ ok: true });
});
app.put("/api/state", async (req, res) => {
  const u = res.locals.user as User;
  // Older web clients do not know about meetings. Preserve them on legacy saves.
  const incoming =
    req.body.state && typeof req.body.state === "object"
      ? {
          ...req.body.state,
          meetings: req.body.state.meetings ?? JSON.parse(u.state).meetings,
        }
      : req.body.state;
  const parsed = stateSchema.safeParse(incoming);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0].message });
  const r = await db
    .prepare(
      "UPDATE users SET state=?,revision=revision+1 WHERE id=? AND revision=?",
    )
    .run(JSON.stringify(parsed.data), u.id, Number(req.body.revision));
  if (!r.changes)
    return res.status(409).json({
      error: "Your data changed in another tab. Reload before trying again.",
    });
  res.json({ revision: u.revision + 1 });
});
app.post("/api/schedule", async (req, res) => {
  const u = res.locals.user as User;
  try {
    const state = schedule(
      stateSchema.parse(JSON.parse(u.state)),
      req.body.start,
      req.body.end,
    );
    const r = await db
      .prepare(
        "UPDATE users SET state=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .run(JSON.stringify(state), u.id, Number(req.body.revision));
    if (!r.changes)
      return res
        .status(409)
        .json({ error: "Your data changed. Reload and try again." });
    res.json({ state, revision: u.revision + 1 });
  } catch {
    return res
      .status(400)
      .json({ error: "Choose a valid planning window of up to 24 hours." });
  }
});
const client = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client/dist",
);
app.use(express.static(client));
app.get("/{*path}", (req, res) =>
  req.path.startsWith("/api")
    ? res.sendStatus(404)
    : res.sendFile(path.join(client, "index.html")),
);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    void _next;
    const status =
      "status" in err &&
      typeof err.status === "number" &&
      err.status >= 400 &&
      err.status < 500
        ? err.status
        : 500;
    if (status === 500) console.error(err.message);
    res.status(status).json({
      error:
        status === 400
          ? "Invalid JSON request."
          : status === 413
            ? "Request is too large."
            : "The request could not be completed.",
    });
  },
);
app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
  () =>
    console.log(
      `FocusFlow running at http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`,
    ),
);
if (
  process.env.NODE_ENV !== "test" &&
  process.env.REMINDER_WORKER_DISABLED !== "true"
) {
  const interval = setInterval(() => {
    reminderWorker
      .tick()
      .then(() => reminderWorker.receipts())
      .catch(() => console.error("Reminder worker failed; it will retry."));
  }, 30000);
  interval.unref();
}
