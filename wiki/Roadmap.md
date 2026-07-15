# Roadmap

Planned work beyond the current MVP/demo. Status key: ✅ done · 🚧 in progress · 🔜 planned.

## Phase 1 — Core ops (current)

| Item | Status | Notes |
|------|--------|-------|
| Central map database | ✅ | Prisma schema, phases, events |
| Graphics workflow | ✅ | Prep → upload review → polish → QA |
| Role-based dashboards | ✅ | Leader, inspector, QA, OPS, supervisor |
| Demo login | ✅ | Seeded users, `DEMO_MODE` |
| Activity / audit log | ✅ | `MapEvent`, phase history |
| Hub status board | ✅ | OPS + supervisor live board |
| Shift planner & availability | ✅ | Roster, submissions, plans |
| End-of-shift reports | ✅ | Basic reporting panel |
| Spreadsheet sync | ✅ | Google Sheets + CSV (OPS) |
| Local Docker Postgres | ✅ | `db:local:setup` |
| Google sign-in | ✅ | Optional OAuth |

## Phase 2 — Integrations

| Item | Status | Notes |
|------|--------|-------|
| Real Jira webhook intake | 🔜 | Replace "Simulate Jira" stub |
| Jira field mapping | 🔜 | Client, area, due date, priority |
| Duplicate detection at intake | 🔜 | Agent-assisted |
| SSO role mapping (Google groups) | 🔜 | Replace manual `UserRole` edits |
| Mapping Partner portal | 🔜 | Daily report: complete / cancel / incomplete |
| Production deployment guide | 🔜 | Hosting, env, CI |

## Phase 3 — Exception handling & automation

| Item | Status | Notes |
|------|--------|-------|
| Exception queue UI | 🔜 | Cancelled / incomplete routing |
| Return-visit scheduling | 🚧 | `returnVisitAt` field exists |
| Auto-reroute suggestions | 🔜 | Agent proposes target stage |
| Notifications (email / Slack) | 🔜 | Hub notifications started server-side |

## Phase 4 — AI agents

| Item | Status | Notes |
|------|--------|-------|
| Intake draft agent | 🔜 | Jira → structured map request |
| Prep & availability agent | 🔜 | Flag mismatched readiness |
| End-of-shift summary agent | 🔜 | Draft from day's events |
| Data quality agent | 🔜 | Required field checks at intake |

Design principles: agents read/write the event log; sensitive actions require human approval. See [[OPS Process Overview]].

## Technical debt & quality

| Item | Status | Notes |
|------|--------|-------|
| Query performance indexes | 🚧 | Migration in progress |
| Admin UI for user roles | 🔜 | Currently DB-only |
| E2E test suite | 🔜 | — |
| API OpenAPI spec | 🔜 | — |

## How to contribute

1. Pick an item from Phase 2+ or open a GitHub issue
2. Branch from `main`, follow existing patterns in `backend/src/services/workflow.ts` and role dashboards in `frontend/src/components/`
3. Update this wiki and the repo `README.md` when adding user-facing features

## Feedback

Product context and pain points are documented in:

- `docs/OPS_TOOL_ANALYSIS.md` — full product analysis (Hebrew)
- `docs/ops-processes/` — per-stage process specs
