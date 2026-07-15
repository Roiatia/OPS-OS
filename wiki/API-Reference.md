# API Reference

Base URL (local): `http://localhost:3001/api`

All endpoints except auth config require a **JWT** in the `Authorization: Bearer <token>` header (returned by `/auth/demo` or `/auth/google`).

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/auth/config` | — | Public config (Google client ID, demo mode) |
| `POST` | `/auth/demo` | — | Demo login `{ "email": "..." }` |
| `POST` | `/auth/google` | — | Google ID token exchange |
| `GET` | `/auth/demo-users` | — | List demo users (when demo mode on) |
| `GET` | `/auth/me` | ✓ | Current user + roles |

## Maps — read

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `GET` | `/maps` | ✓ | List maps (filtered by role) |
| `GET` | `/maps/:id` | ✓ | Map detail with tasks, events |
| `GET` | `/maps/dashboard` | ✓ | Role-specific dashboard payload |
| `GET` | `/maps/history` | Leader, OPS Admin | Completed / archived maps |
| `GET` | `/maps/team` | Leader, OPS, Supervisor | Team roster |
| `GET` | `/maps/hub` | OPS Admin, Supervisor, SL | Hub status board |
| `GET` | `/maps/hub/notifications` | OPS Admin | Hub notification feed |
| `GET` | `/maps/team-field` | Supervisor, SL | Supervisor field queue |

## Maps — graphics workflow

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `POST` | `/maps` | Leader | Create map (Jira intake) |
| `POST` | `/maps/:id/assign` | Leader | Assign inspector (+ optional QA) |
| `PATCH` | `/maps/:id/inspector-status` | Inspector | `accepted` / `processing` / `done` |
| `POST` | `/maps/:id/upload-review` | QA, OPS Admin | Approve/reject upload |
| `POST` | `/maps/:id/field-complete` | Leader | Stub: mark field done |
| `POST` | `/maps/:id/qa-review` | QA, Inspector, OPS Admin | `fix` / `fix_done` / `approved` |
| `POST` | `/maps/:id/tasks` | Leader, QA | Add task to map |
| `PATCH` | `/maps/tasks/:taskId` | ✓ | Update task status |

## Maps — OPS & supervisors

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `PATCH` | `/maps/:id/hub` | OPS Admin, Supervisor, SL | Update hub board status |
| `POST` | `/maps/:id/assign-supervisor` | OPS Admin | Assign supervisor to map |
| `PATCH` | `/maps/:id/supervisor-status` | Supervisor, SL | Supervisor queue status |
| `PATCH` | `/maps/:id/supervisor-field` | Supervisor, SL | Field progress / completion |
| `POST` | `/maps/swap-supervisor` | Supervisor, SL | Swap supervisor on maps |
| `POST` | `/maps/sync-spreadsheet` | OPS Admin, OPS Manager 2 | Import from Google Sheets |

## Maps — notes & attachments

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `POST` | `/maps/:id/notes` | ✓ | Add note to map |
| `POST` | `/maps/:id/attachments` | ✓ | Add attachment metadata |

## Availability & shifts

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `GET` | `/availability/roster` | OPS | Supervisor availability roster |
| `PUT` | `/availability/roster/:userId` | OPS | Update roster entry |
| `GET` | `/availability/submissions` | OPS, Supervisor | Availability submissions |
| `PUT` | `/availability/submissions` | Supervisor | Submit availability |
| `POST` | `/availability/validate` | ✓ | Validate availability rules |
| `GET` | `/availability/shift-plans` | OPS | List shift plans |
| `POST` | `/availability/shift-plans` | OPS | Create shift plan |
| `GET` | `/availability/shift-plans/:id` | OPS | Shift plan detail |
| `PUT` | `/availability/shift-plans/:id` | OPS | Update shift plan |

## Reports

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| `GET` | `/reports` | OPS | List end-of-shift reports |
| `GET` | `/reports/:id` | OPS | Report detail |
| `PATCH` | `/reports/:id/note` | OPS | Add note to report |

## Common request bodies

### Inspector status

```json
{ "status": "accepted" }
{ "status": "processing" }
{ "status": "done" }
```

### QA review

```json
{ "status": "fix", "comment": "Label overlap on aisle 4" }
{ "status": "fix_done" }
{ "status": "approved" }
```

### Upload review

```json
{ "approved": true }
{ "approved": false, "comment": "Missing legend" }
```

## Error responses

| Code | Meaning |
|------|---------|
| `401` | Missing or invalid JWT |
| `403` | Wrong role for this action |
| `404` | Map or resource not found |
| `400` | Invalid status transition or body |

## Source code

- Routes: `backend/src/routes/`
- Workflow logic: `backend/src/services/workflow.ts`
