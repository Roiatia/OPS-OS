# OPS-OS

A full-stack operations platform for mapping workflows. OPS-OS replaces scattered Excel spreadsheets with a single source of truth: every map is one record, every change is an event, and each team works from a role-specific dashboard.

Built as a demo/MVP for the Oriient mapping operations org — starting with the Graphics team workflow and expanding into OPS management, supervisor field work, shift planning, and hub status tracking.

## Why this exists

Today, map status lives across multiple Excel files, chats, and end-of-shift reports. OPS-OS centralizes that into:

- **One map record** — client, area, phase, assignees, field progress, QA state
- **Event log** — every assignment, status change, note, and approval is recorded
- **Role-based views** — each team sees only what they need to act on
- **Spreadsheet bridge** — optional CSV/Google Sheets sync while teams migrate off Excel

Longer product context: [docs/OPS_TOOL_ANALYSIS.md](docs/OPS_TOOL_ANALYSIS.md) and [docs/ops-processes/overview.md](docs/ops-processes/overview.md).

## What's implemented

| Area | Capabilities |
|------|--------------|
| **Graphics** | Map intake (Jira stub), prep assignment, inspector status tracking, QA upload approval, polish + QA review (fix / fix done / approved), per-map task table |
| **OPS managers** | Hub status board, map assignment to supervisors, spreadsheet sync, shift planning, availability roster, end-of-shift reports, history |
| **Supervisors** | Hub board, field work status, supervisor swap, team maps, availability submission |
| **Shared** | Map detail page with phase stepper, notes, attachments, activity log, demo login, optional Google sign-in |

## Roles and dashboards

| Role | Dashboard | Primary actions |
|------|-----------|-----------------|
| Graphic Team Leader | `/app/leader/maps` | Intake maps, assign inspectors/QA, manage tasks, import CSV |
| Mapping Inspector | `/app/inspector` | Accept → Processing → Done on prep and polish maps |
| Graphic QA | `/app/qa` | Approve/reject uploads, request fixes, final approval |
| OPS Admin / OPS Manager 2 | `/app/ops/hub` | Hub board, supervisor assignment, shift planning, reports, spreadsheet sync |
| Supervisor / Shift Leader | `/app/supervisor/hub` | Field work updates, hub status, team availability |

## Map lifecycle

Maps move through phases tracked in the database:

```
INTAKE → PREP → UPLOAD_REVIEW → FIELD → POLISH → QA_REVIEW → APPROVED
                                                              ↘ CANCELLED
```

- **Prep / Polish** — inspector sets `accepted` → `processing` → `done`
- **Upload review** — QA approves or rejects the dashboard upload
- **Field** — supervisors report completion (or partial progress / return visit)
- **QA review** — QA can request a fix; inspector marks fix done; QA approves

## Tech stack

| Layer | Stack |
|-------|-------|
| Backend | Node.js, Express, Prisma, PostgreSQL |
| Frontend | React 19, Vite, Tailwind CSS 4, React Router |
| Auth | JWT + demo users; optional Google OAuth |
| Database | Supabase (hosted) or local Docker Postgres |

## Quick start

### Prerequisites

- Node.js 20+
- npm
- A PostgreSQL database (Supabase **or** local Docker — see below)

### Option A — One command (after DB is configured)

From the repo root, with `backend/.env` in place:

```bash
npm install    # installs root script only
./start.sh     # or: npm run dev
```

This starts the API at `http://localhost:3001` and the UI at `http://localhost:5173`.

### Option B — Local Postgres (no Supabase)

```bash
cd backend
npm install
npm run db:local:setup   # starts Docker Postgres, migrates, seeds
npm run dev
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

### Option C — Supabase (hosted)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy connection URLs into `backend/.env` (see `backend/.env.example`)
3. Full steps: [docs/supabase-setup.md](docs/supabase-setup.md)

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

### First login

Open `http://localhost:5173` and sign in with a **demo user** (no Google setup required when `DEMO_MODE=true`).

| User | Email | Role |
|------|-------|------|
| Sarah Cohen | `leader@ops-demo.local` | Graphic Team Leader |
| David Levi | `inspector@ops-demo.local` | Mapping Inspector |
| Maya Rosen | `qa@ops-demo.local` | Graphic QA |
| Rachel Ops | `ops@ops-demo.local` | OPS Admin |
| Miriam Levy | `ops2@ops-demo.local` | OPS Manager 2 |
| Alex Ben-Ami | `supervisor@ops-demo.local` | Supervisor |
| Dana Weiss | `supervisor2@ops-demo.local` | Supervisor Shift Leader |

Additional inspectors, QA, and supervisors are seeded for multi-user demos. Run `npm run db:seed` in `backend/` to refresh demo data.

## Demo the graphics workflow

1. **Leader** — open a map (e.g. `MAP-2024-0847`), assign to David Levi, or create a new map via "Simulate Jira intake"
2. **Inspector** — sign in as David, set status Accepted → Processing → Done
3. **QA** — sign in as Maya, approve the upload on the map in Upload Approval
4. **Leader** — mark field work complete (simulates supervisors finishing)
5. **Inspector** — polish: Accepted → Processing → Done
6. **QA** — approve, or request Fix → Inspector marks Fix done → QA final approve

## Google sign-in (optional)

1. Create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/)
2. Add authorized JavaScript origin: `http://localhost:5173`
3. Set in `backend/.env` and `frontend/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
DEMO_MODE=true
```

New Google users default to Mapping Inspector. Assign roles in the database until SSO group mapping is added.

## Environment variables

Copy `backend/.env.example` → `backend/.env`. Key settings:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL connection (Supabase or local) |
| `JWT_SECRET` | Signs session tokens |
| `DEMO_MODE` | Enables passwordless demo login |
| `GOOGLE_CLIENT_ID` | Optional Google OAuth |
| `GOOGLE_SHEETS_*` | Optional spreadsheet sync for OPS |

Frontend: `frontend/.env` — set `VITE_API_URL` if the API is not on `localhost:3001`.

## Project structure

```
OPS-OS/
  backend/              Express API, Prisma schema, seeds, scripts
    prisma/             Schema, migrations, seed data
    src/routes/         REST endpoints (maps, auth, availability, reports)
    src/services/       Workflow and business logic
  frontend/             React SPA
    src/pages/          Role dashboards and map detail
    src/components/     Leader, OPS, supervisor, workflow UI
  docs/                 Process specs, Supabase setup, DB migration notes
  docker-compose.yml    Local Postgres for development
  start.sh              Start backend + frontend together
```

## API overview

| Endpoint | Who | Action |
|----------|-----|--------|
| `POST /api/maps` | Leader | Create map from Jira intake |
| `POST /api/maps/:id/assign` | Leader | Assign inspector |
| `PATCH /api/maps/:id/inspector-status` | Inspector | `accepted` / `processing` / `done` |
| `POST /api/maps/:id/upload-review` | QA | Approve/reject dashboard upload |
| `POST /api/maps/:id/field-complete` | Leader | Stub: supervisors done |
| `PATCH /api/maps/:id/supervisor-field` | Supervisor | Field progress and completion |
| `POST /api/maps/:id/qa-review` | QA / Inspector | `fix`, `fix_done`, `approved` |
| `GET/PATCH /api/maps/hub` | OPS / Supervisor | Hub status board |
| `POST /api/maps/sync-spreadsheet` | OPS | Import from Google Sheets / CSV |
| `GET/PUT /api/availability/*` | OPS / Supervisor | Shift planning and availability |

## Useful backend scripts

Run from `backend/`:

| Script | Purpose |
|--------|---------|
| `npm run db:setup` | Migrate + seed (Supabase or configured DB) |
| `npm run db:local:setup` | Docker Postgres + migrate + seed |
| `npm run db:reseed-maps` | Refresh demo map data |
| `npm run db:hub-demo` | Hub board demo setup |
| `npm run db:use-local` / `db:use-supabase` | Switch `.env` between local and Supabase |

## Documentation

- [Supabase setup](docs/supabase-setup.md)
- [OPS process overview (6-stage flow)](docs/ops-processes/overview.md)
- [Product analysis & MVP priorities](docs/OPS_TOOL_ANALYSIS.md)
- [DB region migration](docs/db-region-migration.md)

## Roadmap

- Real Jira webhook intake
- Mapping Partner daily reporting portal
- SSO role mapping from Google groups
- Agent layer for intake drafts, exception routing, and end-of-shift summaries
