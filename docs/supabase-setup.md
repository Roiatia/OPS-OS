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

## Troubleshooting

**`Can't reach database server` (P1001)**

1. **SSL / certificate errors** — Append `?uselibpqcompat=true&sslmode=require` to both `DATABASE_URL` and `DIRECT_URL`. Quick check: `npm run db:check`
2. **Use the Session pooler host** from Supabase → Settings → Database (e.g. `aws-1-ap-northeast-1.pooler.supabase.com`, not `db.xxx.supabase.co` if that hostname does not resolve).
3. **Auto-detect pooler region** — from `backend`: `npm run db:find-pooler`
4. **Project paused** — free-tier Supabase projects pause after inactivity; open the dashboard and **Restore project**.
5. **Network restrictions** — Supabase → Database → Network → allow your IP (or disable restrictions for dev).
6. **Local fallback** — from `backend`: `npm run db:local:setup` (Docker Postgres on `localhost:5432`).

**Migration fails with pooler** — Ensure `DIRECT_URL` uses port **5432** (session pooler), not port 6543 (transaction pooler).

**Re-seed users only** — Safe to run `npm run db:seed` again; users are upserted by email.

**Reset database** — Supabase SQL Editor: drop tables or use **Reset database** in project settings (destructive).
