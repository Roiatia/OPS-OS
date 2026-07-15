# Database Setup

OPS-OS uses **PostgreSQL** via Prisma. Choose **Supabase** (hosted) or **local Docker** (offline dev).

## Supabase (hosted)

### 1. Create a project

1. Go to [supabase.com](https://supabase.com) and sign in
2. **New project** → name (e.g. `ops-os`), set a database password, pick a region
3. Wait until the project is ready

### 2. Connection strings

In Supabase: **Project Settings → Database → Connection string**

Copy the URI (port **5432**) into `backend/.env`:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
```

> Use the **same URL** in both fields for local dev. Prisma uses `DIRECT_URL` for migrations when a pooler is configured later.

**SSL issues?** Append to both URLs:

```
?uselibpqcompat=true&sslmode=require
```

**Pooler host?** Some regions use `aws-1-REGION.pooler.supabase.com` instead of `db.xxx.supabase.co`. Run `npm run db:find-pooler` from `backend/` to auto-detect.

### 3. Initialize

```bash
cd backend
npm install
npm run db:setup    # prisma migrate deploy + seed
```

### 4. Verify

In Supabase **Table Editor**, you should see `User`, `UserRole`, `Map`, `Task`, `MapEvent`, etc.

Or in **SQL Editor**:

```sql
SELECT u.name, u.email, ur.role
FROM "User" u
JOIN "UserRole" ur ON ur."userId" = u.id
ORDER BY u.name;
```

## Local Docker Postgres

No Supabase account needed. Uses `docker-compose.yml` at the repo root.

```bash
cd backend
npm run db:local:setup
```

This will:

1. Start Postgres 16 on `localhost:5432` (user/password/db: `postgres`/`postgres`/`ops_os`)
2. Switch `backend/.env` to local URLs via `db:use-local`
3. Run migrations and seed

To switch back to Supabase later: `npm run db:use-supabase`

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Can't reach database server` (P1001) | Check SSL params, restore paused Supabase project, or use `db:local:setup` |
| Migration fails with pooler | Use port **5432** (session pooler), not **6543** (transaction pooler) for `DIRECT_URL` |
| Re-seed safely | `npm run db:seed` — users are upserted by email |
| Full reset (Supabase) | Project Settings → Reset database (destructive) |
| Connection check | `npm run db:check` from `backend/` |

## Schema management

| Task | Command |
|------|---------|
| Apply migrations | `npm run db:migrate` |
| Dev migration (creates new) | `npm run db:migrate:dev` |
| Regenerate Prisma client | `npm run db:generate` |

Schema source: `backend/prisma/schema.prisma`
