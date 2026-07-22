# OPS-OS — Cloud SQL Database Access Guide

The OPS-OS database lives in Google Cloud SQL (migrated from Supabase).

- **GCP project:** `ops-tools-503212`
- **Instance:** `ops-os-db` (Postgres 17, region `europe-west3`)
- **Instance connection name:** `ops-tools-503212:europe-west3:ops-os-db`
- **Database:** `postgres`
- **DB user for the team:** `ops_dev` (password shared separately — ask Eyal F.)

## One-time setup (each developer, ~5 minutes)

You do NOT need to know anything about Google Cloud. Three steps:

### 1. Install the Google Cloud CLI

```bash
brew install --cask google-cloud-sdk
```

(or download from https://cloud.google.com/sdk/docs/install)

### 2. Log in with your Oriient Google account

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project ops-tools-503212
```

A browser window opens — pick your `@oriient.me` account. That's it, no extra
passwords. Your Google work account is what authorizes you.

Ask Eyal F. to grant your account:

- **Cloud SQL Client** (`roles/cloudsql.client`)
- **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`)

### 3. Install the Cloud SQL Auth Proxy

```bash
brew install cloud-sql-proxy
```

### 4. Configure `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Set the `ops_dev` password in both URLs (or set `CLOUD_SQL_PASSWORD` and run
`npm run db:use-cloudsql` from `backend/`):

```env
DATABASE_URL="postgresql://ops_dev:<PASSWORD>@127.0.0.1:5433/postgres"
DIRECT_URL="postgresql://ops_dev:<PASSWORD>@127.0.0.1:5433/postgres"
```

**Do not commit** `.env` or share the password in git/Slack channels that are logged.

## Daily use

Start the proxy in a terminal (leave it running while you develop):

```bash
cloud-sql-proxy --gcloud-auth --port 5433 ops-tools-503212:europe-west3:ops-os-db
```

The cloud database is now available at `localhost:5433`, exactly like a local
Postgres (port 5433 is used so it never clashes with a local Postgres on 5432).

Verify:

```bash
cd backend
npm run db:check
```

> If the proxy complains it "could not find default credentials", run
> `gcloud auth application-default login` once and start it again.

## What you can do

The `ops_dev` user owns the `public` schema and all tables in it — you can
read, write, create, alter, and drop tables (Prisma migrations work fine).

## How security works (in one sentence)

There is no IP allowlist and the DB is not directly reachable from the
internet; the proxy tunnels your connection using your Google login, which was
granted Cloud SQL Client + Service Usage Consumer — so access is revoked simply
by removing those roles.

## Troubleshooting

- **`permission denied` from the proxy** — your account may be missing the
  Cloud SQL Client role, or you logged into the wrong Google account. Run
  `gcloud auth login` again and check you picked `@oriient.me`.
- **`connection refused` on localhost** — the proxy isn't running, or you're
  using the wrong port.
- **`403 ... serviceusage.services.use` / `USER_PROJECT_DENIED`** — your
  account is missing the Service Usage Consumer role on the project; ask
  Eyal F. to grant it.
