# Getting Started

This guide gets OPS-OS running on your machine for development or demos.

## Prerequisites

- **Node.js** 20+
- **npm**
- **PostgreSQL** — Supabase (hosted) or Docker (local)

## Option A — One command (recommended)

After [[Database Setup]] is done and `backend/.env` exists:

```bash
# From repo root
npm install
./start.sh
# or: npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3001 |

Press `Ctrl+C` to stop both services.

## Option B — Local Postgres (no Supabase)

Requires [Docker](https://www.docker.com/).

```bash
cd backend
npm install
npm run db:local:setup   # Docker Postgres + migrate + seed
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

## Option C — Supabase (hosted)

See [[Database Setup]] for connection strings, then:

```bash
cd backend
npm install
npm run db:setup    # migrate + seed
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

## First login

1. Open http://localhost:5173
2. Click **Demo login** (works when `DEMO_MODE=true` in `backend/.env`)
3. Pick a user — see [[Roles and Dashboards]] for the full list

### Quick demo accounts

| Email | Role |
|-------|------|
| `leader@ops-demo.local` | Graphic Team Leader |
| `inspector@ops-demo.local` | Mapping Inspector |
| `qa@ops-demo.local` | Graphic QA |
| `ops@ops-demo.local` | OPS Admin |
| `supervisor@ops-demo.local` | Supervisor |

## Project layout

```
OPS-OS/
  backend/          Express + Prisma API
  frontend/         React + Vite UI
  docs/             In-repo documentation
  docker-compose.yml Local Postgres
  start.sh          Start both services
```

## Useful backend scripts

Run from `backend/`:

| Command | Purpose |
|---------|---------|
| `npm run db:setup` | Migrate + seed |
| `npm run db:local:setup` | Docker + migrate + seed |
| `npm run db:seed` | Re-seed users and sample data |
| `npm run db:reseed-maps` | Refresh demo maps |
| `npm run db:hub-demo` | Hub board demo setup |
| `npm run db:use-local` | Point `.env` at local Postgres |
| `npm run db:use-supabase` | Point `.env` at Supabase |

## Next steps

- Run through the [[Demo Walkthrough]]
- Read [[Map Lifecycle]] to understand phases
- Configure [[Configuration]] for Google sign-in or spreadsheet sync
