# Staff Portal Invite-Based Provisioning — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Repo:** erxu168/Odoo_Portal_18EE (Next.js portal) + companion Odoo addon
**Related:** docs/memory — portal_account_provisioning, portal_recruitment_bridge

---

## 1. Problem & Goals

Today, staff who do **not** come through recruitment get a portal account by **self-registering** at `/register`: they type their email/phone, the portal matches it against an Odoo `hr.employee`, and on a match it creates a `portal_users` row (status `pending`) with `employee_id` stamped in; an admin must then approve it. Weaknesses:

- **Brittle matching** — a typo or phone-format mismatch yields `NO_MATCH` (no account), with no fallback or later re-match.
- **Admin-create trap** — `POST /api/admin/users` creates an account with **no** `employee_id` and no UI to set one → an orphan account that fails every employee-gated feature.
- **No bulk onboarding** — the ~250 existing staff must each self-register one at a time.
- **Two manual steps** per person (register → approve).

**Goals (all four, per stakeholder):** easier for staff to get in, less admin work, onboard everyone at once, and foolproof (always linked to the correct person; no orphan accounts).

## 2. Chosen Approach

**Flip to an invite ("push") model.** The employer invites staff instead of staff hunting for themselves. Each invite is bound to **one specific** `hr.employee`, so linkage is correct by construction — the email/phone matching guesswork disappears entirely. Being invited **is** the approval, so the separate approval step is removed.

This was chosen over (B) patching self-registration and (C) manager-creates-each-account because it is the only option that satisfies all four goals; it can still absorb the best of B/C (a forgiving setup page, a manager-driven staff list).

## 3. User Flows

### 3.1 Staff member (invitee)
1. Receives a message containing a **unique invite link** (and/or QR): "Welcome to Krawings — set up your account."
2. Opens the link → a public landing page greets them by name and asks them to **set a password**.
3. On submit: their `portal_users` account is created **active** and **already linked** to their employee record; they are logged in. One tap, one password, done.

### 3.2 Admin / manager
A new **"Staff Access"** screen in the portal admin area:
- Lists **all employees** read live from Odoo `hr.employee`, each with a status: **Not invited · Invited (waiting) · Active**.
- **"Invite everyone not yet set up"** button (bulk) to onboard the existing crew in one action.
- Per-row **Invite**, **Resend**, and **Copy/Share** (copies a ready-to-send message + link to paste into WhatsApp/SMS).
- Surfaces who has not finished, at a glance.

### 3.3 New hire (automatic)
When an `hr.employee` is **created** in Odoo, Odoo calls the portal to **auto-create an invite** (and email it if an address exists). No one has to remember to invite new hires.

## 4. Architecture & Components

### 4.1 Data model (SQLite, portal DB)
New table **`portal_invites`**:

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| employee_id | INTEGER | Odoo hr.employee id this invite is bound to (indexed) |
| name | TEXT | snapshot of employee name (for the landing page) |
| email | TEXT NULL | snapshot of email if known (for delivery) |
| token_hash | TEXT | SHA-256 of the random token; raw token never stored |
| status | TEXT | `pending` \| `accepted` \| `revoked` (expired is derived from expires_at) |
| created_at | TEXT | ISO |
| expires_at | TEXT | created_at + 14 days |
| accepted_at | TEXT NULL | |
| created_by | TEXT | admin user id, or `odoo:auto` for auto-invite |
| last_sent_at | TEXT NULL | for resend/throttling |

No `portal_users` row is created at invite time. On **accept**, a `portal_users` row is created (`role='staff'`, `status='active'`, `employee_id` stamped from the invite, `applicant_id=NULL`). This avoids half-accounts and keeps "Active" meaning "has logged-in-capable account".

**Status derivation for the admin list:** for each Odoo employee → `Active` if an active `portal_users` row with that `employee_id` exists; else `Invited` if a non-expired `pending` invite exists; else `Not invited`.

### 4.2 Portal endpoints
**Public (in middleware PUBLIC_PATHS):**
- `GET /api/invite/[token]` — validate token (exists, pending, not expired); return employee name + expiry for the landing page. Never reveals data on invalid/expired tokens beyond a generic state.
- `POST /api/invite/[token]/accept` `{ password }` — re-validate; enforce password rules (≥8 chars, ≥1 digit; reuse current rules); create the linked `portal_users` row; mark invite `accepted`; establish a session. Single-use (a second accept fails). Rate-limited.

**Admin (cookie auth, `hasRole('admin')` — matching the existing admin area; can be extended to manager+ later):**
- `GET /api/admin/staff-access` — employee list (from Odoo) joined with invite/account status.
- `POST /api/admin/staff-access/invite` `{ employee_id }` — create invite, send email if address present, return link + share text. No-op (clear message) if the employee already has an account or a live pending invite.
- `POST /api/admin/staff-access/invite-all` — invite every employee that has neither an account nor a live pending invite; return a summary (created / skipped / failed).
- `POST /api/admin/staff-access/[inviteId]/resend` — issue a fresh token (invalidating the old), re-send/return link.

**Internal (bearer token — reuse `KRAWINGS_INTERNAL_API_TOKEN`):**
- `POST /api/internal/hr/staff-invite` `{ employee_id }` — called by Odoo on employee-create; creates an invite and emails it if possible. Auth + rate-limit pattern identical to the recruitment bridge internal endpoints.

### 4.3 Pages
- `/invite/[token]` — public invite landing + set-password screen (reuses the design system; mobile-first per the project UX standard).
- `/admin/staff-access` — the Staff Access management screen (status list, invite, invite-all, resend, copy/share).

### 4.4 Delivery (channel-agnostic)
A small **delivery layer** builds the invite message (link + friendly copy) once and exposes it to multiple channels:
- **Email** — send via the existing portal mailer (Phase 1).
- **Copy/Share** — the admin UI exposes the link + a ready-to-paste message for WhatsApp/SMS (Phase 1, zero integration).
- **Automated SMS / WhatsApp** — a pluggable provider interface, implemented in **Phase 2** (Twilio for SMS; WhatsApp Business API). Designed as plug-ins so "invite all" can later fan out over these channels with no rework.

### 4.5 Odoo side (companion addon)
A small addon (working name **`krawings_portal_invite`**) adds an **automated action on `hr.employee` create** that POSTs `{ employee_id }` to `/api/internal/hr/staff-invite` using the existing `krawings.portal_base_url` + `krawings.internal_api_token` system parameters (same shared helper pattern as the recruitment bridge). Best-effort: a failed portal call never blocks employee creation in Odoo. Lives in `odoo-modules/` (version-controlled, like its siblings).

## 5. Foolproof Linking (the core win)

`employee_id` is captured at **invite creation** (admin picks the employee, or Odoo passes its id) and stamped onto the account at **accept**. There is **no email/phone matching** in this flow at all, so typos, phone formats, and duplicate-contact ambiguity cannot mislink an account. The legacy unlinked **admin-create path is retired for staff**: admins provision staff only via Staff Access invites. Default: free-form admin account creation is kept **only** for non-employee/admin accounts and clearly relabeled (e.g. "Create admin/non-staff account") so it can never again silently produce a broken staff account.

## 6. Security
- Token: 32 bytes from a CSPRNG, URL-safe; only its SHA-256 hash is stored; constant-time comparison.
- Single-use; 14-day expiry; resend invalidates prior token.
- Public accept endpoint rate-limited (per token + per IP).
- Internal endpoint bearer-auth + rate-limit (reuse recruitment-bridge pattern).
- Invalid/expired tokens return a generic "this invite is no longer valid — ask your manager to resend" without leaking whether a token ever existed.

## 7. Decisions (locked)
- Invite link expiry: **14 days**, resendable.
- Old `/register` self-sign-up: **kept as a quiet fallback** (not the primary path; no further investment now).
- Trigger: **both** — auto-invite on new Odoo hire **and** a bulk "invite all" button.
- Channels: **email + copy/share now (Phase 1); automatic SMS + WhatsApp later (Phase 2).**

## 8. Error Handling
- Invite an employee who already has an account → friendly "already set up" (no duplicate; `getUserByEmployeeId` guard).
- Invite all → per-employee result summary; one failure never aborts the batch.
- Employee with no email → invite still created; admin uses Copy/Share.
- Expired/used token on landing/accept → generic invalid state + "ask your manager to resend."
- Odoo→portal auto-invite failure → logged, never blocks employee creation; the bulk button is the safety net.

## 9. Testing
- Unit: token generate/hash/verify; expiry; status derivation.
- API: invite (single/bulk/dup-guard), accept (success, expired, reused, weak password), resend (old token dies), internal endpoint auth (401 without token, 404 unknown employee), status-list join.
- Odoo: automated action fires on employee create and calls the portal (mock/stub).
- End-to-end: invite → accept → account created + linked → `/api/hr/employee` returns 200 (no longer 401).

## 10. Out of Scope (YAGNI)
- Automated SMS/WhatsApp sending (Phase 2).
- SSO / external identity providers.
- Self-service "re-link / merge" if Odoo contact details change after acceptance.
- A periodic safety-net sync cron (can be added later if auto-invite proves lossy).
- Reworking the legacy self-register matching logic (kept as-is, fallback only).

## 11. Open Questions (defaults chosen; revisit if needed)
- **Role gate:** default `admin` only (matches existing admin area); revisit if managers need it.
- **Free-form admin create:** default keep it but relabel for non-employee/admin accounts only (per §5); revisit if it should be removed entirely.
- **Per-company scoping:** default global "invite all"; revisit per-company scoping only if the single list proves unwieldy at ~250.
