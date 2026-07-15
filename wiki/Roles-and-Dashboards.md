# Roles and Dashboards

OPS-OS uses **role-based access control (RBAC)**. Each user can hold one or more roles; the app redirects to the right dashboard after login.

## Role summary

| Role | Dashboard route | What they do |
|------|-----------------|--------------|
| **Graphic Team Leader** | `/app/leader/maps` | Intake maps, assign inspectors and QA, manage per-map tasks, CSV import |
| **Mapping Inspector** | `/app/inspector` | Work prep and polish maps: Accepted → Processing → Done |
| **Graphic QA** | `/app/qa` | Approve/reject uploads, request fixes, final QA approval |
| **OPS Admin** | `/app/ops/hub` | Hub status board, supervisor assignment, shift planning, reports |
| **OPS Manager 2** | `/app/ops/hub` | Same OPS surface (secondary manager role) |
| **Supervisor** | `/app/supervisor/hub` | Field work updates, hub board, team maps |
| **Supervisor Shift Leader** | `/app/supervisor/hub` | Supervisor + shift-leader approvals |

All roles can open **map detail** at `/app/maps/:id` when they have access to that map.

## Demo users (seed data)

Sign in with demo login using these emails (`DEMO_MODE=true`):

### Graphics team

| Name | Email | Role |
|------|-------|------|
| Sarah Cohen | `leader@ops-demo.local` | Graphic Team Leader |
| David Levi | `inspector@ops-demo.local` | Mapping Inspector |
| Yossi Barak | `inspector2@ops-demo.local` | Mapping Inspector |
| Noa Mizrahi | `inspector3@ops-demo.local` | Mapping Inspector |
| Amir Goldberg | `inspector4@ops-demo.local` | Mapping Inspector |
| Maya Rosen | `qa@ops-demo.local` | Graphic QA |
| Rina Shalev | `qa2@ops-demo.local` | Graphic QA |
| Tomer Avivi | `qa3@ops-demo.local` | Graphic QA |

### OPS & supervisors

| Name | Email | Role |
|------|-------|------|
| Rachel Ops | `ops@ops-demo.local` | OPS Admin |
| Miriam Levy | `ops2@ops-demo.local` | OPS Manager 2 |
| Alex Ben-Ami | `supervisor@ops-demo.local` | Supervisor |
| Dana Weiss | `supervisor2@ops-demo.local` | Supervisor Shift Leader |
| Noam Katz | `supervisor3@ops-demo.local` | Supervisor |
| Lior Hadad | `supervisor4@ops-demo.local` | Supervisor |

Refresh seed data: `npm run db:seed` in `backend/`.

## Leader dashboard (`/app/leader`)

- **Maps** — active maps, assignment, intake (Jira stub)
- **Team** — graphics team roster
- **History** — completed / archived maps
- **Company** — client-level view
- **Settings** — leader preferences
- **CSV import** — bulk map intake

## Inspector dashboard (`/app/inspector`)

Inbox of maps assigned for **prep** or **polish**. Status buttons:

1. **Accepted** — picked up the map
2. **Processing** — actively working
3. **Done** — hand off to next phase

## QA dashboard (`/app/qa`)

Two queues:

- **Upload Approval** — maps in `UPLOAD_REVIEW` phase
- **QA Review** — maps in `QA_REVIEW` phase (approve, or request fix)

## OPS dashboard (`/app/ops`)

- **Hub** — live status board for field maps
- **Maps** — full OPS map board, supervisor assignment
- **Shift planner** — build shifts from availability
- **Availability** — supervisor availability roster
- **Reports** — end-of-shift reports
- **Spreadsheet sync** — Google Sheets / CSV import
- **History** — audit trail

## Supervisor dashboard (`/app/supervisor`)

- **Hub** — maps on the status board
- **Maps** — assigned field maps, progress updates
- **Team** — shift team view
- **History** — past activity
- **Availability** — submit weekly availability

## Assigning roles to real users

Demo users are seeded automatically. For Google sign-in users:

1. User signs in → created with default **Mapping Inspector** role
2. Add roles via database (`UserRole` table) or future admin UI
3. Planned: SSO group → role mapping
