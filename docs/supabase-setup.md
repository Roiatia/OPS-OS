# Supabase — database setup

OPS-OS uses **Supabase Postgres** as the database. Prisma manages the schema; the seed script creates 3 demo users (one per graphics role).

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → pick org, name (e.g. `ops-os`), database password, region.
3. Wait until the project is ready.

## 2. Get your connection string

In Supabase: **Project Settings → Database → Connection string**

You’ll usually see **one URI** like:

```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```

That’s enough. Put the **same URL** in both `DATABASE_URL` and `DIRECT_URL` in `backend/.env` (replace `[YOUR-PASSWORD]` with your real database password).

```env
DATABASE_URL="postgresql://postgres:YOUR_REAL_PASSWORD@db.mdhuxvqkgdhpolkufasn.supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:YOUR_REAL_PASSWORD@db.mdhuxvqkgdhpolkufasn.supabase.co:5432/postgres"
```

> **Why two variables?** Prisma supports a separate “direct” URL for migrations when you use a connection pooler later. For this demo, duplicate the same direct URL in both fields.

### Optional: second URL (pooler)

Some Supabase screens also show a **pooler** URL (port `6543`) under **Connection pooling**. You only need that when you scale production traffic. For local dev and this demo, the single direct URL on port **5432** is fine.

## 3. Initialize the database

From the `backend` folder:

```powershell
cd backend
npm install
npm run db:migrate
npm run db:seed
```

- **`db:migrate`** — creates all tables and enums in Supabase  
- **`db:seed`** — inserts 3 fictional users (see below)

## 4. Demo users (seed)

| Name | Email | Role |
|------|-------|------|
| Sarah Cohen | `leader@ops-demo.local` | Graphic Team Leader |
| David Levi | `inspector@ops-demo.local` | Mapping Inspector |
| Maya Rosen | `qa@ops-demo.local` | Graphic QA |

Use **demo login** on the frontend with these emails (`DEMO_MODE=true`).

The seed also adds 3 sample maps if the database is empty (for workflow demos).

## 5. Verify in Supabase

**Table Editor** you should see:

- `User` — 3 rows  
- `UserRole` — 3 rows  
- `Map`, `Task`, `MapEvent` — after seed (sample data)

Or run in **SQL Editor**:

```sql
SELECT u.name, u.email, ur.role
FROM "User" u
JOIN "UserRole" ur ON ur."userId" = u.id
ORDER BY u.name;
```

## 6. Realtime (live updates via WebSocket)

Dashboards and the map detail page update live using **Supabase Realtime Broadcast**
instead of only polling. The backend emits a small "maps changed" signal after every
successful mutation; connected clients react by refetching through the normal REST API
(so role-based visibility and custom-JWT auth are unchanged). Polling stays on as a slow
safety net (60s when Realtime is configured, 15s when it isn't).

### 6a. Get your Realtime keys

In Supabase: **Project Settings → API**

- **Project URL** — e.g. `https://xxxxx.supabase.co`
- **anon public** key — safe to expose in the browser
- **service_role** key — server-only secret, never ship to the frontend

### 6b. Environment variables

Add to **`backend/.env`** (used to send broadcasts):

```env
SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

Create **`frontend/.env`** (used to subscribe; Vite only exposes `VITE_`-prefixed vars):

```env
VITE_SUPABASE_URL="https://xxxxx.supabase.co"
VITE_SUPABASE_ANON_KEY="your-anon-public-key"
```

> If these are omitted, the app still works — it just falls back to 15s polling and logs
> a warning on the backend. No code changes needed to turn Realtime on/off.

### 6c. Install deps & run

`@supabase/supabase-js` is already in `frontend/package.json`. After pulling, run
`npm install` in `frontend` (and `backend`), then start normally with `./start.sh`.

No database replication or RLS setup is required — Broadcast does not read table data,
so this works with the existing schema as-is. Realtime is enabled by default on new
Supabase projects.

### 6d. How it works (for maintainers)

- Backend: `backend/src/lib/realtime.ts` posts to Supabase's stateless broadcast REST
  endpoint (`/realtime/v1/api/broadcast/ops-maps/events/maps_changed`). A middleware in
  `backend/src/routes/maps.ts` fires it after any successful `POST`/`PATCH`/`DELETE`,
  including the affected `mapId` when the response carries one.
- Frontend: `frontend/src/lib/supabase.ts` creates the anon client and
  `frontend/src/lib/useMapsRealtime.ts` subscribes to the `ops-maps` channel. Dashboards
  refetch on any change; the map detail page refetches only when the change matches its
  `mapId`.

### 6e. Verify

Open two browser windows logged in as different users. Change a map in one (assign,
status, note) and the other should update within ~1s without a manual refresh. On the
backend console you should **not** see the `realtime … disabled` warning.

## Troubleshooting

**`Can't reach database server`** — Check password, project ref, and that IP allowlist allows your connection (Supabase: Database → Network restrictions).

**Migration fails with pooler** — Ensure `DIRECT_URL` uses port **5432** (direct), not the pooler port.

**Re-seed users only** — Safe to run `npm run db:seed` again; users are upserted by email.

**Reset database** — Supabase SQL Editor: drop tables or use **Reset database** in project settings (destructive).

**Realtime not updating** — Confirm all four env vars are set (backend `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`, frontend `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) and
that the frontend was restarted after adding `frontend/.env` (Vite reads env only at
startup). Check the browser console for a WebSocket connection to `…supabase.co/realtime`
and the backend console for the `realtime … disabled` warning. Updates still arrive via
polling within 60s regardless.
