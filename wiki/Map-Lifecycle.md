# Map Lifecycle

Every map in OPS-OS follows a single **phase** field. Phase changes are recorded in `MapPhaseHistory` and `MapEvent` for a full audit trail.

## Phase diagram

```
INTAKE → PREP → UPLOAD_REVIEW → FIELD → POLISH → QA_REVIEW → APPROVED
                                                              ↘ CANCELLED
```

| Phase | Who acts | What happens |
|-------|----------|--------------|
| **INTAKE** | Leader | Map created (Jira stub or CSV). Awaits inspector assignment. |
| **PREP** | Inspector | Graphics prepares the map for field work. |
| **UPLOAD_REVIEW** | QA | QA approves or rejects the dashboard upload. |
| **FIELD** | Supervisor / Leader | Field mapping in progress. Supervisors update progress; leader can stub-complete. |
| **POLISH** | Inspector | Post-field graphics polish. |
| **QA_REVIEW** | QA + Inspector | Final QA — may loop through fix cycles. |
| **APPROVED** | — | Map closed successfully. |
| **CANCELLED** | — | Map cancelled (with reason). |

## Sub-statuses

### Inspector status (prep & polish)

Used by **Mapping Inspector** on assigned maps:

```
ACCEPTED → PROCESSING → DONE
```

Advancing to `DONE` typically moves the map to the next phase (e.g. PREP → UPLOAD_REVIEW).

### QA status (QA review)

Used during **QA_REVIEW**:

| Status | Meaning |
|--------|---------|
| `FIX` | QA requested changes |
| `FIX_DONE` | Inspector completed the fix |
| `APPROVED` | QA signed off → map moves to APPROVED |

### Field work status

Used during **FIELD**:

| Status | Meaning |
|--------|---------|
| `UNCOMPLETED` | Field work not finished |
| `COMPLETED` | Field work done |
| `CANCELLED` | Field visit cancelled |

Additional field fields: `fieldProgressPercent`, `returnVisitAt`, `shiftLeaderApproved`.

### Supervisor status

Supervisors track their own work queue:

```
ACCEPTED → PROCESSING → DONE
```

## Per-map tasks

Leaders and QA can add **tasks** on a map (spreadsheet-style):

| Task status | Meaning |
|-------------|---------|
| `PENDING` | Created, not started |
| `ACCEPTED` | Inspector picked up |
| `PROCESSING` | In progress |
| `DONE` | Complete |
| `FIX` / `FIX_DONE` | QA fix loop on a specific task |

## Hub status board

Maps with `onHubStatusBoard = true` appear on the **Hub** for OPS and supervisors — used to coordinate live field operations separately from the graphics phase stepper.

## Events & history

Every significant action writes a `MapEvent`:

- Map created, assigned, phase changed
- Inspector / supervisor / QA status updates
- Notes and attachments added
- Upload approved or rejected

View history on the map detail page or in role-specific **History** panels.

## Related guides

- [[Demo Walkthrough]] — walk through the full graphics path
- [[API Reference]] — endpoints that drive phase transitions
- [[OPS Process Overview]] — how this fits the broader 6-stage ops vision
