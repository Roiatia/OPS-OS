# Database Setup

OPS-OS uses **PostgreSQL** via Prisma. Primary host is **Google Cloud SQL**;
**local Docker** remains available for offline work.

## Cloud SQL (default)

Full access guide: [docs/cloud-sql-access.md](../docs/cloud-sql-access.md)

### 1. GCP login + Auth Proxy (one-time)

```bash
brew install --cask google-cloud-sdk
brew install cloud-sql-proxy
gcloud auth login
gcloud auth application-default login
gcloud config set project ops-tools-503212
```

Ask Eyal F. for the `ops_dev` password and the Cloud SQL Client + Service Usage
Consumer roles on project `ops-tools-503212`.

### 2. Connection strings

Copy `backend/.env.example` → `backend/.env` and set:

```env
DATABASE_URL="postgresql://ops_dev:YOUR_PASSWORD@127.0.0.1:5433/postgres"
DIRECT_URL="postgresql://ops_dev:YOUR_PASSWORD@127.0.0.1:5433/postgres"
```

Or set `CLOUD_SQL_PASSWORD="..."` and run `npm run db:use-cloudsql`.

### 3. Daily: start proxy, then app

```bash
cloud-sql-proxy --gcloud-auth --port 5433 ops-tools-503212:europe-west3:ops-os-db
```

```bash
cd backend
npm install
npm run db:check    # optional connectivity check
npm run db:setup    # migrate + seed (only if schema/data not already present)
```

## Local Docker Postgres

No GCP access needed. Uses `docker-compose.yml` at the repo root.

```bash
cd backend
npm run db:local:setup
```

This will:

1. Start Postgres on `localhost:5432` (user/password/db: `postgres`/`postgres`/`ops_os`)
2. Switch `backend/.env` to local URLs via `db:use-local`
3. Run migrations and seed

To switch back to Cloud SQL: `npm run db:use-cloudsql`

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Can't reach database` / connection refused | Start the Auth Proxy on port **5433**, or use `db:local:setup` |
| `403 serviceusage.services.use` | Ask for Service Usage Consumer on `ops-tools-503212` |
| Wrong password | Update `ops_dev` password in `backend/.env` (ask Eyal F.) |
| Re-seed safely | `npm run db:seed` — users are upserted by email |
| Connection check | `npm run db:check` from `backend/` |

## Schema management

| Task | Command |
|------|---------|
| Apply migrations | `npm run db:migrate` |
| Dev migration (creates new) | `npm run db:migrate:dev` |
| Regenerate Prisma client | `npm run db:generate` |

Schema source: `backend/prisma/schema.prisma`
