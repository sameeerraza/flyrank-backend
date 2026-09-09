# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small CRUD "Task API" (Express + Postgres), built as a series of staged
FlyRank internship backend assignments (A1, A2, A3). `README.md` has the
full endpoint table, task JSON shape, and validation rules.

## Commands

```bash
cp .env.example .env      # required before first run; set POSTGRES_PASSWORD
docker compose up         # build the API image + start Postgres, together
docker compose down       # stop both; keeps the taskdata volume
docker compose down -v    # stop both AND delete the data
```

`docker compose up` is the primary way to run the stack. Postgres starts
first, the API waits on its healthcheck, then `init()` creates the `tasks`
table and seeds 3 rows on first boot. API on http://localhost:3000.

Running without Docker (needs a Postgres reachable at `DATABASE_URL`):

```bash
npm install
npm start        # node --env-file=.env src/index.js
npm run dev      # same, with --watch
```

SQL shell against the running container:

```bash
docker compose exec db psql -U postgres -d tasks
```

There is no build step, linter, or test suite in this repo.

## Architecture

Two files under `src/`, split strictly by responsibility:

- **`src/index.js`** — Express app: route handlers, request validation,
  status codes, error handling. Contains no SQL. Route handlers are
  `async` and `await` the `db.js` functions. Boot sequence: `init()` then
  `app.listen()`; if `init()` rejects (e.g. Postgres unreachable) the
  process logs and `exit(1)`s rather than serving a broken API.
- **`src/db.js`** — the only file that talks to Postgres. Holds a `pg`
  `Pool` built from `DATABASE_URL`. `init()` runs `CREATE TABLE IF NOT
  EXISTS` and seeds 3 example tasks only when the table is empty. Exports
  one async function per operation (`getAllTasks`, `getTaskById`,
  `createTask`, `updateTask`, `deleteTask`), each returning plain task
  objects — `done` is already a native boolean (no `0`/`1` conversion,
  unlike the earlier SQLite version). Writes use `RETURNING` to get the
  row back in one round trip; `updateTask` uses `COALESCE($n, col)` so a
  partial `{ title, done }` (either key `undefined` → `NULL`) leaves the
  untouched column alone.

This split is intentional and has survived in-memory → SQLite → Postgres
without changing any route's request/response contract. The Postgres move
did change route handlers from synchronous to `async`/`await` (the `pg`
client is async where `better-sqlite3` was sync), but paths, status
codes, JSON shape, and validation are unchanged. If the storage engine
changes again, only `db.js` should need to change.

`/tasks/:id` handlers guard `Number.isNaN(id)` and return `404` before
touching the DB — Postgres throws on `WHERE id = $1` with `NaN`, where
SQLite silently matched nothing.

Error handling: a final `app.use((err, req, res, next) => ...)` catches
JSON body-parse failures (`err.type === "entity.parse.failed"` from
`express.json()`) and returns a clean `400`, and turns anything else into
a generic `500` (logged via `console.error`, never a stack trace to the
client).

## Configuration & infra

- **`DATABASE_URL`** is the connection string. `.env` is git-ignored;
  `.env.example` is committed as a template. `npm start`/`npm run dev`
  load `.env` via `node --env-file`. Under compose the API instead
  receives `DATABASE_URL` as a real env var, with host **`db`** (the
  compose service name), not `localhost`.
- **`compose.yaml`** — `db` (`postgres:17`) + `api` (built from
  `Dockerfile`). The named volume `taskdata` is what persists data across
  `docker compose down`. `depends_on: condition: service_healthy` plus a
  `pg_isready` healthcheck: plain `depends_on` only waits for the
  container to start, and the API exits if it can't connect on boot.
- The image is pinned to `postgres:17` on purpose — Postgres 18 changed
  the data directory layout inside the official image and breaks a volume
  mounted at `/var/lib/postgresql/data`.
- Compose reads `POSTGRES_PASSWORD` from `.env` to both provision the
  Postgres container and build the API's `DATABASE_URL`.
- **`Dockerfile`** runs `CMD ["node", "src/index.js"]`, not `npm start`,
  because `npm start` passes `--env-file=.env` and there is no `.env`
  inside the image — compose supplies env vars directly. `.dockerignore`
  keeps `node_modules`, `.env`, and `.git` out of the build context.
- The `pg` pool sets `idleTimeoutMillis` / `connectionTimeoutMillis` so a
  database restart doesn't leave it hanging on dead sockets.

## API docs

`GET /docs` serves Swagger UI (via `swagger-ui-express`), driven by
`openapi.json` at the repo root. It is not generated from the code — when
adding or changing a route in `src/index.js`, update `openapi.json` to
match.
