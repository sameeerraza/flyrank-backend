# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## What this is

A small CRUD "Task API" (Express + Postgres) with a Supabase Auth layer on
top, built as a series of staged FlyRank internship backend assignments
(A1, A2, A3, A4). `README.md` has the full endpoint table, task JSON
shape, validation rules, and the Supabase setup walkthrough.

Two things are true at once and matter for every change here: the task
CRUD (`/tasks/*`) is intentionally wide open — no auth was ever asked for
on it — and only `/protected/*` plus `/auth/logout` require a bearer
token. Don't "fix" `/tasks` by adding auth to it.

## Commands

```bash
cp .env.example .env      # required before first run — see below
docker compose up         # build the API image + start Postgres, together
docker compose down       # stop both; keeps the taskdata volume
docker compose down -v    # stop both AND delete the data
```

`.env` needs three things before anything will boot: `POSTGRES_PASSWORD`,
and `SUPABASE_URL` / `SUPABASE_KEY` (Project Settings → API in a Supabase
project — the **anon** key, never `service_role`). In the Supabase
dashboard, also turn off Authentication → Sign In / Providers → Email →
"Confirm email", or every fresh signup will be unable to log in.

`docker compose up` is the primary way to run the stack. Postgres starts
first, the API waits on its healthcheck, then `init()` creates the `tasks`
table and seeds 3 rows on first boot, and `checkSupabase()` confirms
Supabase is reachable — both must succeed before the API starts listening.
API on http://localhost:3000, Swagger UI at http://localhost:3000/docs.

Running the API on the host while Postgres stays in Docker (fast-iteration
loop; `npm run dev` watches for changes):

```bash
docker compose up -d --no-deps db
npm run dev
```

`--no-deps` matters: plain `docker compose up db` also starts `api` (since
`db` is `api`'s dependency), and that container binds port 3000 right
alongside the host's `npm run dev` — whichever wins the race serves
requests, silently.

Running fully without Docker (needs a Postgres reachable at
`DATABASE_URL`):

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

Four files under `src/`, split by responsibility:

- **`src/index.js`** — Express app: route handlers, request validation,
  status codes, error handling. Contains no SQL and no direct Supabase
  calls beyond `supabase.auth.signUp`/`signInWithPassword` in the two open
  auth routes. Route handlers are `async` and `await` the `db.js`/
  `supabase.js` functions. Boot sequence: `Promise.all([init(),
  checkSupabase()])` then `app.listen()`; if either rejects, the process
  logs and `exit(1)`s rather than serving a broken API.
- **`src/db.js`** — the only file that talks to Postgres. Holds a `pg`
  `Pool` built from `DATABASE_URL`. `init()` runs `CREATE TABLE IF NOT
  EXISTS` and seeds 3 example tasks only when the table is empty. Exports
  one async function per operation (`getAllTasks`, `getTaskById`,
  `createTask`, `updateTask`, `deleteTask`), each returning plain task
  objects — `done` is a native boolean. Writes use `RETURNING` to get the
  row back in one round trip; `updateTask` uses `COALESCE($n, col)` so a
  partial `{ title, done }` (either key `undefined` → `NULL`) leaves the
  untouched column alone.
- **`src/supabase.js`** — the only file that talks to Supabase. Exports a
  single shared `supabase` client (`persistSession: false`), `checkSupabase()`
  (a boot-time health check via raw `fetch`), and `signOutUser(token)`.
  **The shared client is stateful in memory** — `signInWithPassword()`
  overwrites its ambient session on every login — so nothing in this
  codebase may call an SDK method that implicitly reads that session.
  `getUser(token)` is safe because it takes the token as an explicit
  argument; `signOut()` is *not* safe for that reason (see below), so
  `signOutUser()` bypasses the SDK entirely and hits GoTrue's
  `POST /auth/v1/logout` directly with the caller's own token.
- **`src/authMiddleware.js`** — exports `requireAuth`, the one place bearer
  tokens are extracted and verified. Parses `Authorization: Bearer <token>`
  (checks the literal `"Bearer "` prefix with its trailing space, then
  `.trim()`s the remainder — a header of `Bearer ` with only whitespace
  after it must not slip past a truthiness check as a "real" token), calls
  `supabase.auth.getUser(token)`, and on success attaches both `req.user`
  and `req.token` before calling `next()`. Both protected routes
  (`GET /protected/profile`, `GET /protected/dashboard`) apply this
  middleware and contain zero auth logic of their own — that reuse is the
  whole design point. `POST /auth/logout` also runs behind it, then uses
  `req.token` (not the shared client) to sign out.

This split has survived in-memory → SQLite → Postgres, and unauthenticated
→ Supabase-backed auth, without changing any existing route's request/
response contract. If the storage engine changes again, only `db.js`
should need to change; if the identity provider changes, only
`supabase.js` and `authMiddleware.js` should.

### Why logout can't just call `supabase.auth.signOut()`

The shared `supabase` client in `supabase.js` holds one mutable session in
memory. If `POST /auth/logout` called `supabase.auth.signOut()` (no
arguments — that method takes none), it would sign out whichever session
happened to be sitting in the shared client at that moment — i.e.
whoever logged in *last*, server-wide — not the user whose token was sent
in that specific request. Two concurrent users make this a real bug: user
A's logout request would silently invalidate user B's session instead.
`signOutUser(req.token)` avoids the shared client's session entirely by
calling GoTrue's logout endpoint with the exact token from the request.

`/tasks/:id` handlers guard `Number.isNaN(id)` and return `404` before
touching the DB — Postgres throws on `WHERE id = $1` with `NaN`, where
SQLite silently matched nothing.

Error handling: a final `app.use((err, req, res, next) => ...)` catches
JSON body-parse failures (`err.type === "entity.parse.failed"` from
`express.json()`) and returns a clean `400`, and turns anything else into
a generic `500` (logged via `console.error`, never a stack trace to the
client).

## Configuration & infra

- **`DATABASE_URL`** is the Postgres connection string; **`SUPABASE_URL`**
  / **`SUPABASE_KEY`** (the anon key) are the Supabase project's API
  credentials. `.env` is git-ignored; `.env.example` is committed as a
  template. `npm start`/`npm run dev` load `.env` via `node --env-file`.
  Under compose the API instead receives `DATABASE_URL` as a real env var,
  with host **`db`** (the compose service name), not `localhost` —
  `SUPABASE_URL`/`SUPABASE_KEY` still need to reach the `api` container
  some other way (compose does not currently forward them; export them in
  the shell or add them to `compose.yaml`'s `api.environment` if running
  the auth routes under `docker compose up`).
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
match, including the `security: [{ "bearerAuth": [] }]` entry (defined
under `components.securitySchemes`) for any new bearer-protected route.
