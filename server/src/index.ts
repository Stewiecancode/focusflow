import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import "dotenv/config";
import { z } from "zod";
import { emptyState, stateSchema, schedule } from "./model.ts";
const derive = promisify(scrypt);
const dbPath = process.env.DATABASE_PATH || "./data/focusflow.sqlite";
if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);`);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.status(403).json({ error: "Origin not allowed" });
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
const token = (req: express.Request) => {
  const raw =
    req.headers.cookie
      ?.split(";")
      .find((c) => c.trim().startsWith("focusflow="))
      ?.trim()
      .slice(10) || "";
  return createHash("sha256").update(raw).digest("hex");
};
app.use("/api", (req, res, next) => {
  const user = db
    .prepare(
      "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE token=? AND expires>?",
    )
    .get(token(req), Date.now()) as User | undefined;
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
    return res
      .status(400)
      .json({
        error: "Use a valid email and a password of 10–128 characters.",
      });
  const { email, password, name } = parsed.data;
  let user = db.prepare("SELECT * FROM users WHERE email=?").get(email) as
    User | undefined;
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
    db.prepare(
      "INSERT INTO users(id,name,email,password,state) VALUES(?,?,?,?,?)",
    ).run(
      id,
      name,
      email,
      salt + ":" + hash.toString("hex"),
      JSON.stringify(emptyState()),
    );
    user = db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;
  } else {
    const [salt, hash] = (user?.password || "dummy:" + "0".repeat(128)).split(
      ":",
    );
    const actual = (await derive(password, salt, 64)) as Buffer;
    if (!user || !timingSafeEqual(actual, Buffer.from(hash, "hex")))
      return res.status(401).json({ error: "Email or password is incorrect." });
  }
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const raw = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    createHash("sha256").update(raw).digest("hex"),
    user.id,
    Date.now() + 604800000,
  );
  res.cookie("focusflow", raw, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 604800000,
    path: "/",
  });
  res.json({ name: user.name });
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", (_req, res, next) =>
  res.locals.user ? next() : res.status(401).json({ error: "Please sign in." }),
);
app.post("/api/logout", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token=?").run(token(req));
  res.clearCookie("focusflow", { path: "/" });
  res.json({ ok: true });
});
app.get("/api/state", (_req, res) => {
  const u = res.locals.user as User;
  res.json({ name: u.name, state: JSON.parse(u.state), revision: u.revision });
});
app.put("/api/state", (req, res) => {
  const parsed = stateSchema.safeParse(req.body.state);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0].message });
  const u = res.locals.user as User;
  const r = db
    .prepare(
      "UPDATE users SET state=?,revision=revision+1 WHERE id=? AND revision=?",
    )
    .run(JSON.stringify(parsed.data), u.id, Number(req.body.revision));
  if (!r.changes)
    return res
      .status(409)
      .json({
        error: "Your data changed in another tab. Reload before trying again.",
      });
  res.json({ revision: u.revision + 1 });
});
app.post("/api/schedule", (req, res) => {
  const u = res.locals.user as User;
  try {
    const state = schedule(
      stateSchema.parse(JSON.parse(u.state)),
      req.body.start,
      req.body.end,
    );
    const r = db
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
    console.error(err.message);
    res.status(500).json({ error: "The request could not be completed." });
  },
);
app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `FocusFlow running at http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`,
    ),
);
