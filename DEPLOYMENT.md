# Render + Vercel production deployment

The frontend is a Vite static application on Vercel. Render runs the Express API, and Neon Free Postgres stores accounts, sessions, and task data. No paid Render disk is needed. Keep the GitHub repository private.

## Backend: Render Free

- Source: this repository, `main`; leave Root Directory empty.
- Runtime: Node.js 24 (`.node-version` and `NODE_VERSION`).
- Build: `npm ci --include=dev && npm run build -w server`
- Start: `npm run start -w server`
- Health check: `/api/health`
- Environment: `NODE_ENV=production`, `HOST=0.0.0.0`, `NODE_VERSION=24.16.0`, `DATABASE_URL=<Neon TLS connection string>`, `APP_ORIGINS=<exact Vercel HTTPS origin>`.
- Do not set a local `DATABASE_PATH` on the free service. The API requires durable database configuration before starting in production.

`render.yaml` documents the same service definition. Use either a Blueprint or manual service creation, not both.

## Frontend: Vercel Hobby

- Import the same repository with Root Directory `client` and the Vite preset.
- Node.js 24, build `npm run build`, output `dist`.
- Include files outside the root directory so npm workspaces can resolve the root lockfile.
- The frontend sends requests to `/api`. `client/vercel.json` proxies that path to the exact Render service URL, then falls back to `index.html` for client routes.
- Set the Render `APP_ORIGINS` value to the final Vercel production origin. Preview domains are intentionally not allowed by default.
- Never put `DATABASE_URL` in `VITE_*` environment variables or frontend source.

## Validation and limits

Run `npm run build`, `npm run lint`, and `npm test` before pushing. Verify `/api/health` through Vercel, register a test account, save and reload a workspace, sign out and back in, and verify data after a backend restart.

Free Render compute sleeps when idle and can take time to wake up. Neon also scales to zero and has storage/compute quotas. These are free-plan production URLs, not an always-on availability guarantee. Check provider plan conditions before commercial use; Vercel Hobby is intended for personal, non-commercial projects. No paid plan should be enabled without approval.

Production uses PostgreSQL; local development defaults to SQLite. Existing local SQLite accounts are not automatically copied to Neon. SQL values are parameterized in both adapters. Keep provider-managed database backups or exports before schema changes. Password recovery, email verification, and team sharing are not yet implemented.
