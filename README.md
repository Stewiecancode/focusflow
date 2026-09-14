# FocusFlow

A privacy-conscious productivity application built with React, TypeScript, Vite, Express, and SQLite. Organize your own workspaces and projects, schedule tasks across them, and record focused work.

## Development

Requires Node.js 24. Run `npm install`, then `npm run dev`. Open http://127.0.0.1:5173. The API runs on port 3001. Optional configuration: copy `.env.example` to `server/.env`.

Commands: `npm run dev:client`, `npm run dev:server`, `npm run build`, `npm run lint`, `npm test`. After building, `npm start` serves the application and API at http://127.0.0.1:3001.

## Privacy

The profile asks only “What should we call you?”. Email and password are used only for authentication. No occupation, demographic, employer, or contact profile fields are collected. Workspaces are entirely user-defined.

## Repository

`client/` contains the React interface. `server/` contains the API and persistent database logic. Local databases, environment files, build artifacts, and dependencies are excluded from Git.
