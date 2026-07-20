# User Access — Quick Guide

The **User Access** page is where admins decide *who can do what* in OPS-OS.
Every person has two tabs: **Simple (roles)** and **Advanced (overrides)**.

---

## The two tabs

### Simple — Roles
Pick one or more **ready-made roles** (e.g. OPS Manager, Supervisor, Inspector, QA).
Each role is a bundle of permissions. This is all most users ever need.

- Assigning **multiple roles** is safe — the person simply gets the **combination**
  of everything those roles allow. Roles only ever *add* access; they never take it away.

### Advanced — Overrides
Fine-tune a single person **beyond their roles**, one permission at a time.
Each permission has three states:

| State | Meaning |
|-------|---------|
| **Default** | Inherit — use whatever the person's roles decide |
| **Grant** | Give this permission even if no role includes it |
| **Deny** | Remove this permission even if a role includes it |

---

## How the final permissions are calculated

```
Effective = (all permissions from their roles)
            + granted overrides
            − denied overrides
```

**Key rule:** an override always wins over a role.
So a **Deny** removes a permission the role would otherwise give.
If someone is missing a permission you expected, check the Advanced tab
for a Deny on that permission.

The green dot next to a permission in the Advanced tab means it's currently
**effective** (the person has it). The label underneath tells you *why*:
"Granted by role", "Granted by override", "Denied by override", or "Not granted".

---

## You can't create a conflict

- Two roles can never contradict each other — they only add up.
- A single permission can't be both Granted and Denied (the UI only lets you
  pick one state, and the server rejects contradictions).
- The **Effective permissions** shown on screen is exactly what the system
  enforces — no surprises.

---

## Safety guardrails

- You **cannot remove your own** admin access (Manage users).
- The system always keeps **at least one admin**, so no one can lock everyone out.

---

## Quick recipes

- **Give someone standard access:** Simple tab → tick the matching role → Save.
- **One extra ability for one person:** Advanced tab → set that permission to
  **Grant** → Save.
- **Take one ability away from a role holder:** Advanced tab → set it to
  **Deny** → Save.
- **Reset a person to pure role behavior:** Advanced tab → set every override
  back to **Default** → Save.
