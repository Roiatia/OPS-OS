# Demo Walkthrough

A hands-on tour of the **graphics workflow** using demo users. Takes ~10 minutes with two browser profiles or incognito windows.

## Before you start

1. Complete [[Getting Started]] — app running at http://localhost:5173
2. Confirm `DEMO_MODE=true` in `backend/.env`
3. Seed data present (`npm run db:setup` or `db:seed`)

## Cast

| Step | User | Email |
|------|------|-------|
| Leader | Sarah Cohen | `leader@ops-demo.local` |
| Inspector | David Levi | `inspector@ops-demo.local` |
| QA | Maya Rosen | `qa@ops-demo.local` |

## Step 1 — Leader: intake & assign

1. Sign in as **Sarah Cohen**
2. Go to **Maps** (`/app/leader/maps`)
3. Either:
   - Open existing map **MAP-2024-0847**, or
   - Click **Simulate Jira intake** to create a new map
4. **Assign** the map to **David Levi** (inspector)
5. Optionally assign **Maya Rosen** as QA

**Expected:** Map phase moves to **PREP**. David sees it in his inspector inbox.

## Step 2 — Inspector: prep

1. Sign out → sign in as **David Levi**
2. Open **Inspector** dashboard (`/app/inspector`)
3. Open the assigned map
4. Set status: **Accepted** → **Processing** → **Done**

**Expected:** Map advances to **UPLOAD_REVIEW** (awaiting QA upload approval).

## Step 3 — QA: upload approval

1. Sign out → sign in as **Maya Rosen**
2. Open **QA** dashboard (`/app/qa`)
3. Find the map under **Upload Approval**
4. **Approve** the upload

**Expected:** Map moves to **FIELD** phase.

## Step 4 — Leader: field complete (stub)

Field work is normally done by supervisors. For the graphics demo, the leader simulates completion:

1. Sign in as **Sarah Cohen**
2. Open the map
3. Click **Mark field work complete** (or equivalent field-complete action)

**Expected:** Map moves to **POLISH**.

> For the full supervisor path, sign in as `supervisor@ops-demo.local` and update field progress on the supervisor hub instead.

## Step 5 — Inspector: polish

1. Sign in as **David Levi**
2. Open the map in the inspector inbox (polish queue)
3. **Accepted** → **Processing** → **Done**

**Expected:** Map moves to **QA_REVIEW**.

## Step 6 — QA: final review

### Happy path — approve

1. Sign in as **Maya Rosen**
2. Open map in **QA Review**
3. Click **Approve**

**Expected:** Map phase = **APPROVED**. Appears in history.

### Fix loop (optional)

1. QA clicks **Request fix** → inspector gets fix task
2. Sign in as **David Levi** → mark **Fix done**
3. Sign in as **Maya Rosen** → **Approve**

## Verify the audit trail

Open the map detail page as any user and check:

- **Phase stepper** shows full path
- **Activity log** lists every action with user and timestamp
- **Tasks** table reflects any tasks added during the flow

## OPS & supervisor demo (optional)

| User | Email | Try |
|------|-------|-----|
| Rachel Ops | `ops@ops-demo.local` | Hub board, assign supervisor, shift planner |
| Alex Ben-Ami | `supervisor@ops-demo.local` | Update field progress on hub maps |

Run `npm run db:hub-demo` in `backend/` to populate hub board sample data.

## Reset demo data

```bash
cd backend
npm run db:reseed-maps    # refresh map scenarios
npm run db:seed           # refresh users
```

## See also

- [[Map Lifecycle]] — phase definitions
- [[Roles and Dashboards]] — all demo accounts
