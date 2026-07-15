# Migrating the Supabase Postgres Project to a Closer Region

## Problem statement & expected impact

The app (Express + Prisma backend, Vite/React frontend) uses **Supabase Postgres**.
The current project lives in **Tokyo** (`aws-1-ap-northeast-1.pooler.supabase.com`,
project ref `mdhuxvqkgdhpolkufasn`), but users are in **UTC+3 (Israel)**.

Every DB round-trip crosses ~half the planet, costing **~250 ms**. Because a single
API request in this app runs several sequential queries (Prisma reads + writes,
relation loads via `mapIncludes`, phase-history/event inserts, etc.), that latency
**compounds per request** — a request with 4–6 round-trips can burn **1–1.5 s** in
pure network time before any work happens.

Moving the project to a region near the users (**`eu-central-1` Frankfurt** — recommended
for UTC+3; `eu-west-2` London is a close second) cuts round-trip latency to roughly
**25–50 ms**, a **~5–10x** improvement. This is the single biggest latency win available
and dwarfs any query-level optimization.

## Important caveat (read first)

> **Supabase does NOT support changing a project's region in place.**
> There is no button to "move" a project. You must **create a NEW project in the
> target region and migrate the schema + data into it**, then repoint the app's
> env vars at the new project.

This means a new project ref, new connection strings, new API URL, and new API keys.
Plan a short **maintenance window** for the data copy so no writes are lost.

---

## Step-by-step migration

### 1. Create a new Supabase project in the target region

1. In the Supabase dashboard: **New project**.
2. Pick the same org, a clear name (e.g. `ops-os-eu`), and a **strong database password**
   (store it in your secrets manager — you'll use it as `<PASSWORD>` below).
3. **Region: `Europe (Frankfurt) eu-central-1`** (recommended for UTC+3 users).
4. Wait for the project to finish provisioning.

### 2. Get the new connection strings

New project → **Project Settings → Database → Connection string**:

- Copy the **Session pooler URI** for `DATABASE_URL`
  (host looks like `aws-1-eu-central-1.pooler.supabase.com`).
- Use the same URI for `DIRECT_URL` (this repo already sets both to the pooler host;
  keep the pattern consistent with `backend/.env`).
- If you hit SSL errors, append `?uselibpqcompat=true&sslmode=require` to both URLs
  (see `docs/supabase-setup.md` and `npm run db:check`).

Also grab, from **Project Settings → API**:

- `Project URL` → for `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `service_role` key → for `SUPABASE_SERVICE_ROLE_KEY`
- `anon` / publishable key → for `VITE_SUPABASE_ANON_KEY`

Keep the **old** project's values handy too — you need the old `DIRECT_URL` for the
data dump, and you'll need everything for rollback.

### 3. Migrate the schema (Prisma)

Point Prisma at the **new** DB, then deploy the existing migrations from
`backend/prisma/migrations`:

```bash
cd backend

# Temporarily point at the NEW project (do NOT commit real secrets):
export DATABASE_URL="postgresql://postgres.<NEW-PROJECT-REF>:<PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
export DIRECT_URL="$DATABASE_URL"

npx prisma migrate deploy   # or: npm run db:migrate
```

This recreates the full schema (all enums, `User`, `Map`, `Task`, `MapEvent`,
`OpsDailyReport`, shift/availability tables, indexes) on the new project — empty.

> Do **not** run `prisma migrate dev` or `db push` against production; use
> `migrate deploy` so the migration history matches the repo.

### 4. Migrate the data (maintenance window)

Announce a short maintenance window and **stop backend writes** (pause/stop the
API process) so the source DB is quiescent during the copy.

**Option A — `pg_dump` / `pg_restore` (recommended, full control).**
Dump data-only from the **old** `DIRECT_URL` and load into the **new** one. Because
the schema already exists from Step 3, dump data only and disable triggers on load
to avoid FK ordering issues:

```bash
# 1) Dump DATA ONLY from the OLD (Tokyo) project — password redacted:
pg_dump \
  "postgresql://postgres.mdhuxvqkgdhpolkufasn:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  --schema=public \
  -Fc -f ops-os-data.dump

# 2) Restore into the NEW (Frankfurt) project — password redacted:
pg_restore \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  --dbname="postgresql://postgres.<NEW-PROJECT-REF>:<PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" \
  ops-os-data.dump
```

If you prefer plain SQL instead of the custom format, dump with
`--data-only --column-inserts -f ops-os-data.sql` and load with
`psql "<NEW DIRECT_URL>" -f ops-os-data.sql`.

> Use a Postgres 15+ client (`pg_dump`/`pg_restore`/`psql`) whose major version
> matches (or exceeds) the Supabase server to avoid version-mismatch errors.

**Option B — Supabase CLI tooling.**
Alternatively use the Supabase CLI:

```bash
supabase db dump --db-url "<OLD DIRECT_URL>" --data-only -f ops-os-data.sql
psql "<NEW DIRECT_URL>" -f ops-os-data.sql
```

Supabase's dashboard also offers a guided "Migrate/Restore" flow between projects;
either approach is fine — the goal is a consistent copy taken while writes are paused.

After loading, spot-check row counts on the new DB (e.g. `SELECT count(*) FROM "Map";`,
`"User"`, `"Task"`, `"OpsDailyReport"`) against the old one.

### 5. Update environment variables

Point the app at the new project. Update **`backend/.env`**:

- `DATABASE_URL` → new pooler URI
- `DIRECT_URL` → new pooler URI
- `SUPABASE_URL` → `https://<NEW-PROJECT-REF>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` → new `service_role` key (`<REDACTED>`)

Update **`frontend/.env`**:

- `VITE_SUPABASE_URL` → `https://<NEW-PROJECT-REF>.supabase.co`
- `VITE_SUPABASE_ANON_KEY` → new anon/publishable key (`<REDACTED>`)

> **Do this everywhere, not just locally.** Update the same variables in any
> deployment/hosting environment (host dashboard env vars, CI/CD secrets, container
> env, etc.). The frontend `VITE_*` values are baked in **at build time**, so the
> frontend must be **rebuilt and redeployed** after changing them.

Tip: this repo has `npm run db:use-supabase` / `db:use-local` helpers
(`backend/scripts/switch-db.mjs`) and `npm run db:find-pooler` to detect the correct
pooler host — handy for filling in the new `DATABASE_URL`/`DIRECT_URL`.

### 6. Re-enable Supabase Realtime on the new project

Realtime settings do **not** carry over to a new project.

- The app's live map updates flow through the backend's **own WebSocket server**
  (`/api/ws`, see `backend/src/lib/realtime.ts`), which does **not** depend on
  Supabase Realtime — it just needs the backend running and pointed at the new DB.
- If any client subscribes to Supabase Realtime directly (via `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), you must
  **re-enable Realtime on the new project**: dashboard → **Database → Replication**
  (Realtime publication) and turn on the tables used (primarily **`Map`**, plus any
  others you subscribe to such as `Task` / `MapEvent`).

Confirm the new `SUPABASE_URL`/keys resolve to the new project ref before testing.

### 7. Verify

1. Start the backend against the new DB (`cd backend && npm run dev`), then the
   frontend (`cd frontend && npm run dev`).
2. **Health check:** `curl http://localhost:3001/api/health` → `{ "ok": true, ... }`.
3. **Reads:** load the dashboards (e.g. Inspector board) — existing maps appear.
4. **Writes:** change a map's phase / add a note; confirm it persists (reload).
5. **Realtime:** open two sessions; a change in one appears live in the other
   (WS updates via `/api/ws`, and Supabase Realtime if used).
6. **Latency:** compare API timings to before. Round-trips should drop from
   ~250 ms to ~25–50 ms; overall request times should fall noticeably.

### 8. Cutover & rollback plan

- **Keep the old (Tokyo) project running** until the new one is fully verified in
  production. Do not delete it.
- **Cutover:** once verified, the env changes in Step 5 (plus a frontend rebuild)
  complete the switch. Point production at the new project.
- **Rollback:** if something is wrong, **revert the env vars** in `backend/.env`,
  `frontend/.env`, and all deployment envs back to the old project's values, rebuild
  the frontend, and restart the backend. Because you never modified the old project,
  it remains a valid fallback.
- **Caveat:** any writes made against the *new* DB after cutover will not exist in the
  old DB. Roll back promptly if needed, or re-copy the delta before switching back.
- **Decommission:** delete the old project only after a stable verification period.

---

## Checklist

- [ ] New Supabase project created in **`eu-central-1`** (or `eu-west-2`).
- [ ] New `DATABASE_URL` / `DIRECT_URL` (pooler URI) copied from **Settings → Database**.
- [ ] New `SUPABASE_URL`, `service_role`, and `anon` keys copied from **Settings → API**.
- [ ] Schema deployed to new DB: `cd backend && npx prisma migrate deploy`.
- [ ] Maintenance window announced; backend writes paused.
- [ ] Data copied (`pg_dump` → `pg_restore`/`psql`, or `supabase db dump`); row counts verified.
- [ ] `backend/.env` updated (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] `frontend/.env` updated (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); frontend rebuilt.
- [ ] Deployment/hosting env vars + CI/CD secrets updated everywhere.
- [ ] Supabase Realtime re-enabled on new project for the tables used (e.g. `Map`).
- [ ] Verified: health endpoint, reads, writes, realtime, latency improvement.
- [ ] Old (Tokyo) project kept until verified; rollback path (revert env vars) confirmed.
- [ ] Old project decommissioned after a stable period.
