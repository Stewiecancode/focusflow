import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const schema = `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires BIGINT NOT NULL);`;

export async function createDatabase() {
  if (process.env.DATABASE_URL) {
    // Use the provider's TLS-enabled connection string. Certificate verification stays enabled.
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", () => console.error("Database connection interrupted"));
    await pool.query(schema);
    return {
      prepare(sql: string) {
        let i = 0;
        const query = sql.replace(/\?/g, () => `$${++i}`);
        return {
          async get(...values: SQLInputValue[]) {
            return (await pool.query(query, values)).rows[0] as
              Record<string, unknown> | undefined;
          },
          async run(...values: SQLInputValue[]) {
            const result = await pool.query(query, values);
            return { changes: result.rowCount || 0 };
          },
          async all(...values: SQLInputValue[]) {
            return (await pool.query(query, values)).rows as Record<
              string,
              unknown
            >[];
          },
        };
      },
    };
  }
  const dbPath = process.env.DATABASE_PATH || "./data/focusflow.sqlite";
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.DATABASE_PATH || !path.isAbsolute(dbPath))
  )
    throw new Error(
      "Production requires DATABASE_URL or an absolute DATABASE_PATH on persistent storage",
    );
  if (dbPath !== ":memory:")
    mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  db.exec(schema);
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        async get(...values: SQLInputValue[]) {
          return statement.get(...values);
        },
        async run(...values: SQLInputValue[]) {
          return statement.run(...values);
        },
        async all(...values: SQLInputValue[]) {
          return statement.all(...values);
        },
      };
    },
  };
}
