# Configuration

Environment variables for local development and demos.

## Backend (`backend/.env`)

Copy from `backend/.env.example`:

```bash
cp backend/.env.example backend/.env
```

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct connection for Prisma migrations (same as above for dev) |
| `JWT_SECRET` | Secret for signing session tokens — change in production |
| `PORT` | API port (default `3001`) |

### Auth

| Variable | Description |
|----------|-------------|
| `DEMO_MODE` | `true` enables passwordless demo login |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (optional) |

### Spreadsheet sync (optional)

Used by OPS managers to import maps from Google Sheets or CSV upload in the UI.

| Variable | Description |
|----------|-------------|
| `SPREADSHEET_DEFAULT_CLIENT` | Default client name for imported rows |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Google Sheet ID |
| `GOOGLE_SHEETS_TAB_NAME` | Tab name (e.g. `Sheet1`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account JSON (single-line string) |

## Frontend (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (default `http://localhost:3001`) |
| `VITE_GOOGLE_CLIENT_ID` | Same Google client ID as backend (optional) |

## Google sign-in setup

1. Create an OAuth 2.0 client in [Google Cloud Console](https://console.cloud.google.com/)
2. Application type: **Web application**
3. Authorized JavaScript origins: `http://localhost:5173`
4. Set `GOOGLE_CLIENT_ID` in both `backend/.env` and `frontend/.env`
5. Keep `DEMO_MODE=true` so demo login still works alongside Google

New Google users are assigned **Mapping Inspector** by default until SSO group mapping is implemented.

## Local vs Cloud SQL database

Switch without editing URLs manually:

```bash
cd backend
npm run db:use-cloudsql   # Auth Proxy on 127.0.0.1:5433 (default)
npm run db:use-local      # Docker Postgres on localhost:5432
```

See [docs/cloud-sql-access.md](../docs/cloud-sql-access.md) for GCP setup.

## Production checklist

- [ ] Strong `JWT_SECRET`
- [ ] `DEMO_MODE=false` (or remove demo login in production build)
- [ ] Cloud SQL access via Auth Proxy / IAM (no open public IP allowlist)
- [ ] Google OAuth origins updated for production domain
- [ ] `VITE_API_URL` points to production API
