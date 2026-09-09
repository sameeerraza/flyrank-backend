# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small CRUD "Task API" (Express + SQLite), built as a series of staged
FlyRank internship backend assignments (W2 · A1, W3 · A1). See `README.md`
for the full endpoint table, task JSON shape, and validation rules.

## Commands

```bash
npm install       # install dependencies
npm start         # run the server on http://localhost:3000
npm run dev       # run with --watch (auto-restart on file changes)
```

There is no build step, linter, or test suite configured in this repo.

## Architecture

Two files under `src/`, split strictly by responsibility:

- **`src/index.js`** — Express app: route handlers, request validation,
  status codes, and error handling. Contains no SQL.
- **`src/db.js`** — the only file allowed to talk to SQLite. Opens
  `tasks.db` (created in the project root on first run), creates the
  `tasks` table if missing, and seeds 3 example tasks only when the table
  is empty. Exports one function per data operation (`getAllTasks`,
  `getTaskById`, `createTask`, `updateTask`, `deleteTask`); each returns
  plain task objects with `done` already converted from SQLite's `0`/`1`
  to a real boolean. Route handlers in `index.js` call these functions and
  never construct SQL themselves.

This split is intentional and should be preserved: it's what let the app
migrate from an in-memory array to SQLite (across the W3 · A1 stages)
without changing a single route's request/response contract. If the
storage engine changes again, only `db.js` should need to change.

Error handling: a final `app.use((err, req, res, next) => ...)` middleware
catches JSON body-parse failures (`err.type === "entity.parse.failed"`,
from `express.json()`) and returns a clean `400` JSON error, and turns any
other unexpected error into a generic `500` JSON error (logged server-side
via `console.error`, never leaked to the client as a stack trace).

`tasks.db` is git-ignored (`*.db` in `.gitignore`) — it's generated,
seeded data, not source.

## API docs

`GET /docs` serves Swagger UI (via `swagger-ui-express`), driven by the
OpenAPI spec in `openapi.json` at the repo root. When adding or changing a
route in `src/index.js`, update `openapi.json` to match — it is not
generated from the code.
