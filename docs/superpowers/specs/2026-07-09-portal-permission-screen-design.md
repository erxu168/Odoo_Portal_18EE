# Portal Permission Screen — Design Spec

- **Date:** 2026-07-09
- **Repo:** `erxu168/Odoo_Portal_18EE` (Krawings Portal, Next.js 14, branch `main`)
- **Status:** Approved design, pending implementation plan

---

## 1. Summary (plain language)

Today, "who can do what inside a module" is **hardcoded** in the app. A person's role
(Staff / Manager / Admin) decides which buttons and actions they get, and changing that
requires a developer to edit and redeploy code.

This feature adds an **admin-only Permissions screen** where an admin can turn individual
actions on or off for each role, with the change taking effect immediately (no redeploy).
A switched-off action is **hidden on screen and refused by the server** — genuinely blocked,
not just hidden.

We build the engine + screen once, then wire modules onto it **one at a time**, starting
with **Shifts**.

---

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Granularity | **Every action** gets its own switch |
| Scope | **By role only** — three columns: Staff / Manager / Admin (no per-person overrides in v1) |
| Enforcement | **Truly blocked** — hidden in UI *and* refused by server |
| Rollout | **Phased by module**, verified in a real browser before moving on |
| First module | **Shifts** (the shift scheduling / roster system) |

---

## 3. Goals & non-goals

**Goals**
- One admin screen to configure every action's availability per role.
- Real, server-enforced access control (not cosmetic).
- Safe by construction: on release, behavior is **identical to today** until an admin changes a switch.
- Impossible for an admin to lock themselves out of the Permissions screen.
- A single shared "is this allowed?" check used by both UI and server, so they can never drift.

**Non-goals (v1)**
- Per-person overrides (configuring one individual differently from their role). The data model
  will leave room for it, but it is out of scope now.
- Changing the three-role model (Staff / Manager / Admin stays).
- Reworking module *visibility* (the existing `module_access` system stays as-is and is unaffected).
- Audit history of permission changes (nice-to-have, future).

---

## 4. Current state (what exists today)

- **Roles:** `staff < manager < admin`, stored on `portal_users.role`. Helper `hasRole()` in
  `src/lib/auth.ts`.
- **Module visibility** (separate, unaffected): `src/lib/modules.ts` + `module_access` column.
- **Feature access inside modules — hardcoded, two enforcement layers:**
  - **Server:** `requireRole('manager'|'admin')` from `src/lib/auth.ts` — ~86 call sites across
    64 API route files (82 `manager`, 4 `admin`).
  - **UI:** components read `user.role` / an `isManager` flag to show/hide/enable controls
    (~a dozen components).
- **Shifts specifically:** the UI gates on a single `isManager = role === 'manager' || role === 'admin'`
  in `src/app/shifts/page.tsx`, passed as a prop into ~24 components. On the server, its manager
  routes are guarded by a **custom helper `requireManagerCompany(companyId)`** in
  `src/app/api/shifts/_manager.ts` — which checks **both** `hasRole(user,'manager')` **and** that the
  `company_id` is in the user's `allowed_company_ids` (admins bypass company). So Shifts IS enforced
  today, but via company-scoped manager gating, **not** `requireRole`. **Design consequence:** the new
  system must make only the *role* half configurable and **preserve the company-scope check**, or a
  manager of one restaurant could act on another's shifts (regression). A few self-service/view routes
  are cookie-auth-only (ownership-checked), and two (`shift/staff`, `shift/identify`) have no
  company/role scoping at all — noted for hardening.
- **Storage:** SQLite via `better-sqlite3` (`src/lib/db.ts`), with an established migration
  pattern (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) and existing
  settings tables (`portal_settings`, `company_settings`).

---

## 5. Design

### 5.1 Action registry (the master list)

A single canonical list of every configurable action lives in a new file `src/lib/permissions.ts`:

```ts
export interface PermissionAction {
  key: string;        // stable id, e.g. "shifts.schedule.publish"
  module: string;     // module id from modules.ts, e.g. "shifts"
  label: string;      // plain-English label shown on the screen
  group?: string;     // optional sub-heading within a module
  defaultRoles: Role[]; // roles allowed by default = TODAY's behavior
}
export type Role = 'staff' | 'manager' | 'admin';
```

- `key` is a stable dotted string: `<module>.<object>.<verb>` (e.g. `shifts.shift.create`).
- `defaultRoles` is seeded to **reproduce current behavior exactly** (derived by auditing the
  existing `requireRole` calls / `isManager` gates for that module).
- The registry is the **single source of truth** for what appears on the screen AND what the
  server/UI enforce. Adding a module = adding its entries here.

### 5.2 Storage

New table (v1 keeps it minimal, by-role only):

```sql
CREATE TABLE IF NOT EXISTS feature_permissions (
  action_key   TEXT PRIMARY KEY,
  allowed_roles TEXT NOT NULL   -- JSON array subset of ["staff","manager","admin"]
);
```

- A **missing row** for an action = use the registry `defaultRoles`. This means the table can ship
  empty and behavior is identical to today; rows are written only when an admin changes something.
- (Future per-person overrides would be an additional table keyed by `(user_id, action_key)`,
  layered on top — designed for, not built now.)

### 5.3 The shared check (one function, used everywhere)

In `src/lib/permissions.ts`:

```ts
// Effective roles for an action: stored override if present, else registry default.
export function allowedRolesFor(actionKey: string): Role[];
// Does this role have this action?
export function roleCan(role: Role, actionKey: string): boolean;
```

Both the server guard and the UI use these, so a switch and its enforcement can never diverge.

### 5.4 Server enforcement

Add to `src/lib/auth.ts`:

```ts
// Throws AuthError(403) if the current user's role is not allowed this action.
export function requireCapability(actionKey: string): PortalUser;
```

- For a plain `requireRole('manager')` call site (e.g. Manufacturing), replace it with
  `requireCapability('<action.key>')`. Because each action's `defaultRoles` is seeded from the
  site's current `requireRole` value, the swap is **behavior-preserving** on day one.
- **Composing with company scope (Shifts and any company-scoped module):** where a route uses a
  *company-scoped* gate like `requireManagerCompany(companyId)`, we do **not** drop it. Instead the
  helper is refactored to accept a capability key and use `roleCan(role, key, overrides)` for the
  *role* decision while keeping its existing company-membership check intact. The capability governs
  *who by role*; the company check governs *which restaurants*. Both must pass. With no key passed,
  the helper falls back to `hasRole(user,'manager')` so migration is incremental and safe.

### 5.5 UI enforcement

- `/api/auth/me` already returns the user's allowed **modules**. Extend it to also return the
  user's **allowed action keys** (computed via `roleCan(user.role, key)` over the registry).
- Components replace `isManager` / `role === 'manager'` checks with
  `capabilities.includes('shifts.shift.create')`.
- For Shifts, the single `isManager` prop is replaced by a small `can` helper/object derived
  from the returned capabilities, threaded where `isManager` currently flows.

### 5.6 Admin screen

- New page: **Settings → Permissions**, route `/admin/permissions`, **admin-only** (guarded by
  `requireRole('admin')` server-side on its data endpoints, and hidden in nav otherwise).
- Renders the registry grouped by module → a grid: rows = actions, columns = Staff / Manager / Admin,
  cells = toggle switches (reuse existing toggle component from `src/components/ui/`).
- Switch change → `POST`/`PATCH` to a new admin API (`/api/admin/permissions`) that writes the
  `feature_permissions` row. Reads come from a matching `GET`.
- **Reset to defaults**: per-module and global — deletes the relevant `feature_permissions` rows
  so actions fall back to registry defaults.
- Plain-English labels only; no code keys shown to the user.

### 5.7 Guardrails (safety)

1. **Behavior-preserving launch:** empty config = today's behavior, exactly.
2. **Anti-lockout:** the capability that manages this screen (`permissions.manage`) is
   **hard-locked to admin** and cannot be edited or switched off. Admins therefore always retain
   access to Permissions.
3. **Truly enforced:** every gated action is checked on the server, not just hidden.
4. **Immediate effect:** changes apply on the user's next request / page load (capabilities are
   read fresh from `/api/auth/me` and per-request on the server).

---

## 6. First module: Shifts

Shifts is delivered end-to-end in the first release (engine + screen + Shifts wired + real-browser test).

**Current gating (from code audit):** UI = one `isManager` flag → ~24 components (dashboard
"Plan & Manage"/"Admin" groups are `managerOnly`; the settings gear renders only for managers).
Server = ~35 manager routes guarded by `requireManagerCompany(companyId)` (manager + company scope);
~19 self-service/view routes are cookie-auth-only with ownership checks.

**Action list (finalized from audit — 11 capabilities, each maps to real guarded routes):**

| Action (label) | key | default | maps to |
|---|---|---|---|
| View schedule & own shifts | `shifts.schedule.view` | staff, manager, admin | summary, me, mine, open, hours, requests |
| Request swap / claim / confirm / report sick (self-service) | `shifts.selfservice.submit` | staff, manager, admin | claim, confirm, cover-requests(+accept/decline/cancel), sick-reports |
| Create & edit shifts | `shifts.shift.manage` | manager, admin | slots (POST), slots/[id] (PUT), manage, copy-last-week, templates |
| Delete a shift / series | `shifts.shift.delete` | manager, admin | slots/[id] (DELETE), delete-series |
| Publish a schedule | `shifts.schedule.publish` | manager, admin | publish-week, publish-upcoming, patterns/[id]/publish |
| Manage patterns & runs | `shifts.pattern.manage` | manager, admin | patterns, patterns/[id], runs, runs/[id] |
| Manage roster caps | `shifts.rostercaps.manage` | manager, admin | roster, roster/[employeeId] |
| Approve requests / swaps / sick | `shifts.requests.approve` | manager, admin | approvals, approvals/[id]/(approve\|decline\|undo), sick-reports/[id]/resolve |
| Manage roles & departments | `shifts.rolesdept.manage` | manager, admin | roles(+/[id]), departments(+/[id]) |
| Edit shift settings | `shifts.settings.manage` | manager, admin | settings |
| View manager overviews & KPIs | `shifts.overview.view` | manager, admin | coverage, overview, team, punctuality, timesheet, presence, busy |

(Dropped the earlier `shifts.shift.assign` — there is no distinct assign endpoint; assignment happens
inside create/edit, i.e. `shifts.shift.manage`. Every registry row must map to a real guarded route.)

**Work for Shifts:**
1. Add the 11 registry entries above (defaults = current behavior).
2. Refactor `requireManagerCompany(companyId)` → `requireManagerCompany(companyId, actionKey?)`: use
   `roleCan(role, actionKey, overrides)` for the role decision, **keep the company-membership check**.
   Pass the mapped key at each manager route call site.
3. For the self-service/view routes, add `requireCapability('shifts.selfservice.submit')` /
   `requireCapability('shifts.schedule.view')` at the top (their ownership/company checks remain).
4. Replace the `isManager` prop flow in `src/app/shifts/page.tsx` + components with capability checks.
5. Verify in a real browser on staging with the test users (Hana/staff, Marco/manager) that:
   - defaults behave exactly like today (incl. a manager still can't touch another company), and
   - toggling a switch immediately changes what each role can see and do, server included.

---

## 7. Rollout plan (phased)

1. **Release 1:** engine (`permissions.ts`, table, `requireCapability`, `/api/auth/me` extension),
   the **Permissions admin screen**, and **Shifts** fully wired + browser-tested.
2. Then one module at a time, same pattern, each verified before the next:
   **Inventory → Purchase → HR → Chef Guide → Prep Planner → Supplier Logins → Manufacturing →
   Production Guide → Termination → Rentals.**
   (Order after Shifts can be re-prioritised; Manufacturing/Termination/Rentals already have
   `requireRole` guards so those are lower-risk swaps.)

Each module release: add registry entries (defaults = current behavior) → swap guards →
swap UI checks → real-browser verify.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A wrong default silently changes who can do something | Seed every default from the *existing* guard; verify per module in a real browser before shipping |
| Missing an enforcement point (action still reachable) | Build the action list *from* the code (grep the guards / `isManager` uses), not from memory |
| Admin locks themselves out | `permissions.manage` hard-locked to admin, not editable |
| UI hides but server still allows (cosmetic-only) | Every action gated server-side via `requireCapability`; Shifts gains new server guards |
| Config drift between screen and enforcement | Single registry + single `roleCan()` used by both |
| Large surface (~86 sites) | Phased by module; only Shifts in Release 1 |

---

## 9. Verification

Per project rule (real-browser test before "done"): after each module, Playwright-test on staging
(`portal.krawings.de`) with the test accounts — confirm (a) defaults = today, (b) a toggle changes
both the visible UI and the server's actual allow/deny for that role. Desktop and mobile both checked;
no changes to module-visibility behavior.

---

## 10. Out of scope / future

- Per-person overrides (data model leaves room; not built in v1).
- Audit log of permission changes.
- Bulk "copy Manager column to…" conveniences.
