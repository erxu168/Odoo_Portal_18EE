# Email Single Source of Truth — Design Spec

- **Date:** 2026-07-19
- **Repo:** `erxu168/Odoo_Portal_18EE` (Krawings Portal), branch `main`
- **Status:** Approved design, implementing

## Problem

An employee's **profile Work email** (Odoo `hr.employee.work_email`) and their **Portal Access
login email** (`portal_users.email`, local SQLite) can diverge. Observed: profile
`Jackie.ankomah@gmail.com` vs login `jackie.ankonah@gmail.com` (an "m"/"n" typo, plus casing).

**Root cause:** editing the profile Work email (`PATCH /api/hr/employee/[id]`) writes only to Odoo.
`portal_users.email` is set once at account creation (invite/register) and **never updated** —
`updateUser()` has no `email` field and there is no `UPDATE portal_users SET email` anywhere. The
two stores drift with nothing reconciling them.

## Goal

The **profile Work email is the single source of truth.** Editing it updates the linked login email.
Existing drifted accounts are reconciled in a one-time cleanup.

## Design

### 1. Auto-sync on edit (core)
When `PATCH /api/hr/employee/[id]` changes `work_email`, after the Odoo write, call a new DB helper to
set the linked `portal_users.email` to the same value. Profile → login, one-way.

### 2. One-time reconcile (bulk cleanup)
An **admin-only** endpoint `POST /api/admin/reconcile-emails` iterates `portal_users` with a non-null
`employee_id`, fetches each employee's `work_email` from Odoo, and aligns the login email where it
differs. Returns `{ updated, skippedEmpty, skippedCollision, unchanged }`. Triggered once by an admin
(staging now, prod later). Reusable.

### 3. DB helper
`setUserEmailByEmployeeId(employeeId: number, email: string): 'updated' | 'unchanged' | 'empty' | 'collision'`
- Lowercase + trim the incoming email; if empty → return `'empty'` (no change).
- If the linked user's current email already equals it → `'unchanged'`.
- `UPDATE portal_users SET email = ? WHERE employee_id = ?`, wrapped in try/catch for the UNIQUE
  constraint → on `SQLITE_CONSTRAINT` return `'collision'` (no change); else `'updated'`.

### Safety rules
- **Lowercase/trim both sides** before comparing — casing alone never triggers a change (portal emails
  are already stored lowercased via `createUser`).
- **One-way only** (profile → login). Never login → profile.
- **Empty profile email → skip** (never blank a login credential).
- **Duplicate guard:** a would-be-collision is skipped and reported; the profile save still SUCCEEDS
  (the login sync is best-effort — a profile edit can never fail because of a login-email clash).
- Login disruption is minimal: most staff sign in by **name + PIN**, not email; only email+password
  logins use the new address.

## Files
- `src/lib/db.ts` — add `setUserEmailByEmployeeId()`.
- `src/app/api/hr/employee/[id]/route.ts` — call the helper in PATCH when `work_email` changes. *(HR file
  actively edited by parallel work — keep the change small, commit fast.)*
- `src/app/api/admin/reconcile-emails/route.ts` — new admin reconcile endpoint (Odoo read + bulk sync).

## Verification
- Real-browser/API on staging: edit an employee's Work email → confirm the login email updates to match
  (`getUserByEmployeeId`). Run reconcile once → confirm Jackie's login email becomes `...ankomah` and the
  summary reports the fix. Confirm an empty/colliding case is skipped, not errored.
- Codex code-review of the diff (auth-adjacent), per repo CLAUDE.md.

## Out of scope
- No UI to manually edit the login email (there isn't one today; not adding one).
- Non-employee-linked accounts (e.g. the seeded admin, shared-device logins) are untouched.
