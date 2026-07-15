# OPS-OS Wiki

Welcome to the **OPS-OS** documentation wiki — the operations platform that replaces scattered Excel spreadsheets with a single source of truth for mapping workflows.

## What is OPS-OS?

OPS-OS is a full-stack demo/MVP for Oriient mapping operations. Every **map** is one database record; every status change is an **event**; each team works from a **role-specific dashboard**.

| Concept | Description |
|---------|-------------|
| Map record | Client, area, phase, assignees, field progress, QA state |
| Event log | Assignments, status changes, notes, approvals |
| Role dashboards | Leader, Inspector, QA, OPS, Supervisor views |
| Spreadsheet bridge | Optional CSV / Google Sheets sync during migration |

**Repository:** [Roiatia/OPS-OS](https://github.com/Roiatia/OPS-OS)

## Wiki pages

### Setup & development
- [[Getting Started]] — install, run locally, first login
- [[Database Setup]] — Supabase or local Docker Postgres
- [[Configuration]] — environment variables and auth

### Using the app
- [[Roles and Dashboards]] — who sees what and where
- [[Map Lifecycle]] — phases from intake to approval
- [[Demo Walkthrough]] — step-by-step graphics workflow demo

### Reference
- [[API Reference]] — REST endpoints by role
- [[OPS Process Overview]] — 6-stage operational data flow (product vision)
- [[Roadmap]] — planned features

## Quick links

| Resource | URL |
|----------|-----|
| Frontend (local) | http://localhost:5173 |
| API (local) | http://localhost:3001 |
| Demo login | Use any seeded email when `DEMO_MODE=true` |

## Current implementation status

| Area | Status |
|------|--------|
| Graphics workflow | ✅ Prep, upload review, polish, QA |
| OPS managers | ✅ Hub board, shift planning, reports, spreadsheet sync |
| Supervisors | ✅ Field work, hub status, availability |
| Jira intake (real) | 🔜 Planned |
| Mapping Partner portal | 🔜 Planned |
| AI agents | 🔜 Planned |
