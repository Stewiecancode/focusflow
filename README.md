# FocusFlow

A privacy-conscious productivity application built with React, TypeScript, Vite, Express, and SQLite. Organize your own workspaces and projects, schedule tasks across them, and record focused work.

## Development

Requires Node.js 24. Run `npm install`, then `npm run dev`. Open http://127.0.0.1:5173. The API runs on port 3001. Optional configuration: copy `.env.example` to `server/.env`.

Commands: `npm run dev:client`, `npm run dev:server`, `npm run build`, `npm run lint`, `npm test`. After building, `npm start` serves the application and API at http://127.0.0.1:3001.

## Privacy

The profile asks only “What should we call you?”. Email and password are used only for authentication. No occupation, demographic, employer, or contact profile fields are collected. Workspaces are entirely user-defined.

## Repository

`client/` contains the React interface. `server/` contains the API and persistent database logic. Local databases, environment files, build artifacts, and dependencies are excluded from Git.

## Features

- Register and sign in using email and password; name-only profile onboarding.
- Create any number of named workspaces and projects, without predefined categories.
- Create, edit, complete, reopen, search, and delete tasks with estimates, priorities, and optional due dates.
- View a daily calendar across workspaces, filter by workspace or project, and add or remove time blocks. Conflicting blocks are rejected.
- Automatically schedule unscheduled tasks within a selected window, ordered by due date then priority. Existing blocks stay in place, completed tasks are skipped, and tasks that cannot fit remain unscheduled.
- Run a 15-, 25-, or 50-minute focus timer with pause, reset, and session saving. Saved sessions feed today's productivity totals and recent history.

## Data and security

The hierarchy is User → Workspace → Project → Task → Calendar Block / Focus Session. SQLite stores each user's validated workspace state, with optimistic revision checks to prevent silent overwrites from another tab. Authentication uses salted scrypt password hashes and random, hashed server-side session tokens. Cookies are HttpOnly and SameSite=Strict, with Secure enabled in production. Sessions expire after seven days. Auth attempts are rate-limited per server process.

The database is created in `server/data/` with default settings. Back up the database before upgrades; it is deliberately not committed. No email service, tracking, or personal-background fields are configured. Fonts are loaded from Google Fonts with local font fallbacks.

This is a runnable single-server foundation. Before an internet production launch, configure HTTPS, persistent disk and backups, and your account recovery/email verification policy. Password recovery, email verification, collaboration, and external calendar synchronization are not implemented. The in-memory rate limiter is intended for one server instance. SQLite's Node API currently emits an experimental warning on some Node versions.

## Verification

`npm run build` compiles both applications. `npm run lint` runs ESLint and strict TypeScript checks. `npm test` exercises scheduling conflicts, available-time limits, idempotence, invalid relationships, account isolation, stale revisions, and login/logout against an isolated in-memory database. The API test uses local port 43189.

In restrictive Windows sandboxes, Vite's development dependency optimizer may be denied ancestor-directory access. The production build works using Vite's native config loader. Use `npm run build` followed by `npm start` for preview in that environment. Normal development remains available through `npm run dev` outside that restriction.

## Private GitHub repository

The private repository is https://github.com/Stewiecancode/focusflow. The local `origin` remote points to this repository. The following commands document authentication and verification for future development (repository creation is only needed for a new copy):

```powershell
gh auth login
gh repo create focusflow --private --source=. --remote=origin --push
gh repo view --json nameWithOwner,isPrivate,url
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

The last two hashes should match. If a private remote repository already exists, use `git remote add origin https://github.com/YOUR_USERNAME/focusflow.git` and `git push -u origin main` instead of creating it again.

