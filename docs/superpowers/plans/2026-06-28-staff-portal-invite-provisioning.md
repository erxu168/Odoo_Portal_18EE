# Staff Portal Invite Provisioning — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Replace brittle self-registration with an invite ("push") model: per-employee invite links, bulk "invite all", auto-invite on Odoo hire, foolproof employee linking, email + copy/share delivery.

**Architecture:** New `portal_invites` SQLite table + helpers in `src/lib/db.ts`; business logic in `src/lib/hr/invites.ts`; admin endpoints + a public accept flow; a small Odoo addon that auto-invites on `hr.employee` create. Reuses the recruitment bridge's shared secret (`KRAWINGS_INTERNAL_API_TOKEN`) + system params `krawings.portal_base_url` / `krawings.internal_api_token`.

**Tech Stack:** Next.js 14.2.35 (App Router, sync route params), better-sqlite3, bcryptjs (cost 10), nodemailer, Node `crypto`; Odoo 18 Python addon.

## Global Constraints
- DB access via `getDb()` only (no `db` export); timestamps via `nowISO()`; `const db = getDb()` at top of each helper.
- New table goes in `initTables()` `db.exec(\`...\`)` block (CREATE TABLE IF NOT EXISTS), after `push_subscriptions`.
- Passwords hashed inside `createUser` (bcryptjs cost 10). Password rule: ≥8 chars + ≥1 digit.
- Session: `createSession(userId)` → token; cookie `COOKIE_NAME` ('kw_session') `{httpOnly:true, secure: prod, sameSite:'lax', path:'/', maxAge: 30*24*60*60}`.
- Admin auth guard (Style A): `const me = getCurrentUser(); if (!me || !hasRole(me,'admin')) return 403 {error:'Admin access required'}`.
- Internal bearer guard: copy `verifyBearerToken` (timingSafeEqual, `KRAWINGS_INTERNAL_API_TOKEN`) + rate-limit scaffold from `recruitment/create-access/route.ts`.
- Tokens: `crypto.randomBytes(32).toString('base64url')`; store only `sha256` hex hash; link = `${PORTAL_URL}/invite/<token>` (`PORTAL_URL` env, default `http://89.167.124.0:3000`).
- Invite TTL: 14 days. Verify everything with `npm run build` (the typecheck gate) — no unit-test framework exists.
- New TS code: `catch (err: unknown)` + `instanceof Error`.

## File Structure
- **Modify** `src/lib/db.ts` — add `portal_invites` table + `StaffInvite` type + invite helpers.
- **Create** `src/lib/hr/invites.ts` — `createStaffInvite`, `acceptStaffInvite`, token helpers, `buildInviteRows`.
- **Modify** `src/lib/email.ts` — add `sendStaffInviteEmail`.
- **Modify** `src/middleware.ts` — add `'/invite/'`, `'/api/invite/'` to `PUBLIC_PATHS`.
- **Create** `src/app/api/admin/staff-access/route.ts` — GET (list) + POST (invite/resend/invite_all).
- **Create** `src/app/api/internal/hr/staff-invite/route.ts` — bearer, auto-invite from Odoo.
- **Create** `src/app/api/invite/[token]/route.ts` — GET validate.
- **Create** `src/app/api/invite/[token]/accept/route.ts` — POST accept + session.
- **Create** `src/app/invite/[token]/page.tsx` — public landing + set password.
- **Create** `src/app/admin/staff-access/page.tsx` — admin Staff Access screen.
- **Create** `odoo-modules/krawings_portal_invite/` — addon: auto-invite on `hr.employee` create.

---

### Task 1: DB layer — `portal_invites` table + helpers
**Files:** Modify `src/lib/db.ts`
**Interfaces produced:**
- `interface StaffInvite { id; employee_id; name; email: string|null; token_hash; status; created_at; expires_at; accepted_at: string|null; created_by: string|null }`
- `createInvite(d:{employee_id:number;name:string;email:string|null;token_hash:string;expires_at:string;created_by:string}): number`
- `getInviteByTokenHash(h:string): StaffInvite|null`
- `getActiveInviteByEmployeeId(empId:number): StaffInvite|null` (pending + not expired)
- `revokeInvitesForEmployee(empId:number): void` (pending→revoked)
- `markInviteAccepted(id:number): void`
- `listPendingInvites(): StaffInvite[]` (pending + not expired)
- `listEmployeeIdsWithAccounts(): number[]` (active users, employee_id not null)

- [ ] Add table to `initTables` (after `push_subscriptions`, inside the same `db.exec`):
```sql
CREATE TABLE IF NOT EXISTS portal_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_employee ON portal_invites(employee_id);
CREATE INDEX IF NOT EXISTS idx_invites_token ON portal_invites(token_hash);
```
- [ ] Add `StaffInvite` interface + a `// -- Staff Invites --` section with the helpers (use `nowISO()`, `db.prepare(...).get/all/run`).
- [ ] Verify: `npx tsc --noEmit` passes.
- [ ] Commit.

### Task 2: Invite business logic — `src/lib/hr/invites.ts`
**Consumes:** Task 1 helpers; `getOdoo()`; `createUser/getUserByEmail/getUserByEmployeeId/createSession/logAudit`; `sendStaffInviteEmail`.
**Produces:**
- `createStaffInvite(employeeId:number, actor:{id:number;name:string}, opts?:{sendEmail?:boolean}): Promise<{ok;status;body}>`
- `acceptStaffInvite(token:string, email:string, password:string): {ok;status;body;sessionToken?}`
- `generateInviteToken()`, `hashInviteToken(t)`, `inviteLink(t)`, `shareMessage(name,link)`

Logic: createStaffInvite → 409 if `getUserByEmployeeId`; fetch employee from Odoo (404 if missing); `revokeInvitesForEmployee`; create token+hash, 14-day expiry; `createInvite`; email if `opts.sendEmail && email`; return `{success, invite_id, name, email, email_sent, link, share_text}`. acceptStaffInvite → validate token (404 generic), expiry (410), no existing account (409), valid email + password rule, `createUser({employee_id, status:'active'})`, `markInviteAccepted`, `createSession`.
- [ ] Write the module.
- [ ] Verify `npx tsc --noEmit`.
- [ ] Commit.

### Task 3: Email — `sendStaffInviteEmail`
- [ ] Add to `src/lib/email.ts`, mirroring `sendCandidateWelcomeEmail`: `export async function sendStaffInviteEmail(toEmail, toName, inviteUrl)`, green `#16A34A` button to `inviteUrl`, "set up your account" copy.
- [ ] Verify build; Commit.

### Task 4: Public endpoints — validate + accept
**Files:** Create `src/app/api/invite/[token]/route.ts`, `src/app/api/invite/[token]/accept/route.ts`
- [ ] GET validate: hash token, look up; return `{valid:true, name, email, needs_email:!email, expires_at}` or generic `{valid:false}`. Sync params `{ params }: { params: { token: string } }`.
- [ ] POST accept: parse `{email,password}`; `acceptStaffInvite`; on ok set session cookie + return `{success,name}`; else `NextResponse.json(body,{status})`. Rate-limit by token+ip.
- [ ] Verify build; Commit.

### Task 5: Middleware — public paths
- [ ] Add `'/invite/'` and `'/api/invite/'` to `PUBLIC_PATHS` in `src/middleware.ts`.
- [ ] Verify build; Commit.

### Task 6: Admin endpoints — list + invite/resend/invite_all
**Files:** Create `src/app/api/admin/staff-access/route.ts`
- [ ] GET: admin guard; `getOdoo().searchRead('hr.employee', [['active','=',true]], ['name','work_email','private_email','mobile_phone','department_id'], {limit:1000, order:'name asc'})`; cross-ref `listEmployeeIdsWithAccounts()` + `listPendingInvites()`; return `{employees:[{employee_id,name,email,phone,department,status:'active'|'invited'|'none',invited_at?}], counts}`.
- [ ] POST: admin guard; action `invite`/`resend` → `createStaffInvite`; `invite_all` → loop employees lacking account+pending invite, summarize `{created,skipped,failed}`. `logAudit(module:'staff_access')`. try/catch→500.
- [ ] Verify build; Commit.

### Task 7: Internal endpoint — auto-invite from Odoo
**Files:** Create `src/app/api/internal/hr/staff-invite/route.ts`
- [ ] Copy bearer + rate-limit scaffold; body `{employee_id}`; actor `odoo:<uid>`; call `createStaffInvite`; return `result.body`. (Middleware already allows `/api/internal/`.)
- [ ] Verify build; Commit.

### Task 8: Public invite page — `/invite/[token]`
**Files:** Create `src/app/invite/[token]/page.tsx`
- [ ] Client component: fetch GET on mount; show greeting + form (email prefilled/editable, password, confirm); POST accept; success → `router.push('/')`; handle invalid/expired with friendly message. Portal styling (green, rounded cards).
- [ ] Verify build; Commit.

### Task 9: Admin Staff Access screen — `/admin/staff-access`
**Files:** Create `src/app/admin/staff-access/page.tsx`
- [ ] Mirror `admin/users/page.tsx`: AppHeader (supertitle ADMIN, "Invite all" action), fetchAll, 403→error, status pills (Active green / Invited amber / None gray), per-row Invite/Resend + Copy-link (show returned link + share text after invite for SMS/WhatsApp paste), invite-all confirm sheet with count.
- [ ] Verify build; Commit.

### Task 10: Odoo addon — auto-invite on hire
**Files:** Create `odoo-modules/krawings_portal_invite/` (`__manifest__.py` v18.0.1.0.0 depends `['hr']`, `__init__.py`, `models/__init__.py`, `models/hr_employee.py`, `utils.py`)
- [ ] `hr_employee.py`: inherit `hr.employee`, override `@api.model_create_multi def create`; after super, if system param `krawings.portal_auto_invite_enabled` truthy (default true), best-effort POST `{employee_id}` to `/api/internal/hr/staff-invite` per new employee via `utils.portal_post` (bearer; reuse `krawings.portal_base_url`/`krawings.internal_api_token`). Never raise.
- [ ] `utils.py`: same `portal_post(env, path, payload)` helper pattern as `krawings_recruitment`.
- [ ] Compile-check (`python3 -m py_compile`); XML/manifest valid; Commit.

---

## Deployment (staging)
1. Push all commits to `main`.
2. On `89.167.124.0`: `cd /opt/krawings-portal && git fetch && git reset --hard origin/main && npm run build && systemctl restart krawings-portal` (build needed — middleware + new routes/pages).
3. Set system param `krawings.portal_auto_invite_enabled='1'`. Symlink `odoo-modules/krawings_portal_invite` into custom-addons; `-u krawings_portal_invite` (install) from /tmp; restart odoo-18. (Reuses the token + base_url params already set for the recruitment bridge.)
4. The `portal_invites` table is created automatically on first `getDb()` (after restart).

## Verification (staging)
- `npm run build` clean (typecheck gate).
- Internal endpoint: 401 without token; with token + bogus employee → 404 "Employee not found in Odoo".
- Throwaway end-to-end: create a temp `hr.employee` (with a fake email) in Odoo → confirm auto-invite row created (or call admin invite) → GET the invite token validates → POST accept → `portal_users` row created with correct `employee_id`, logged in → `/api/hr/employee` returns 200. Then clean up (delete temp employee + portal user + invite).
- Admin screen loads, lists employees with correct statuses, invite/resend/copy work.

## Out of Scope (Phase 2)
Automated SMS/WhatsApp sending; phone-as-login; self-service re-link; production deploy (prod Odoo lacks the addon).
