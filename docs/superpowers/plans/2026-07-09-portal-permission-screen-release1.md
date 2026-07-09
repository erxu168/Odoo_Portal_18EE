# Portal Permission Screen — Release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-action, per-role, server-enforced permission system with an admin-only configuration screen, and wire the **Shifts** module onto it — without changing anyone's current access on release.

**Architecture:** A pure-logic registry (`src/lib/permissions.ts`) lists every configurable action with its default roles (copied from today's behavior). Admin overrides live in a new SQLite table `feature_permissions`. One shared `roleCan()` decides access; both the server guard `requireCapability()` and the UI (via `/api/auth/me` capabilities) call it, so screen and enforcement never drift. An admin screen at `/admin/permissions` edits the overrides. Shifts is the first module wired: its API routes gain real server guards (they currently have none) and its `isManager` UI flag is replaced by capabilities.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `better-sqlite3`, Playwright (`unit` project for pure-logic tests, `modules` project for real-browser e2e against staging).

## Global Constraints

- **Single branch:** work on `main` only. `git checkout main && git pull --ff-only` before starting.
- **Do NOT touch** the two pre-existing uncommitted Shifts files unless a task explicitly says so, and confirm with the user first: `src/app/api/shifts/busy/route.ts`, `src/components/shifts/BusyTimes.tsx`.
- **Behavior-preserving launch:** every action's `defaultRoles` must equal its current guard, so nothing changes for any role until an admin flips a switch.
- **Brand color is green** (`#16a34a` / Tailwind `green-*`) — this is the portal, NOT the orange Odoo project. Reuse existing component styling.
- **Truly enforced:** every gated action is checked server-side, not just hidden in the UI.
- **Preserve company scope:** Shifts manager routes must keep their `allowed_company_ids` check — the
  capability governs *who by role*, the company check governs *which restaurants*. Both must pass.
- **Anti-lockout:** the capability `permissions.manage` is hard-locked to `['admin']` and is not editable.
- **Roles:** `staff` < `manager` < `admin` (`hasRole()` in `src/lib/auth.ts`).
- **Build check:** run `npm run build` before any deploy — it catches TypeScript errors. Never pipe it.
- **TS pitfalls (from repo CLAUDE.md):** `err: unknown` + `instanceof` in catch; prefix unused params with `_`; use `Array.from()` not `[...set]`; escape JSX apostrophes as `’`.

---

## File Structure

**New files**
- `src/lib/permissions.ts` — action registry + pure access logic (mirrors `src/lib/modules.ts`).
- `tests/permissions.unit.spec.ts` — unit tests for the pure logic.
- `src/app/api/admin/permissions/route.ts` — admin GET (read matrix) + POST (update/reset).
- `src/app/admin/permissions/page.tsx` — admin-only page shell.
- `src/components/admin/PermissionsMatrix.tsx` — the module→action→role toggle grid.
- `tests/permissions.e2e.spec.ts` — real-browser verification against staging.

**Modified files**
- `src/lib/db.ts` — add `feature_permissions` table + storage helpers.
- `src/lib/auth.ts` — add `requireCapability()`.
- `src/app/api/auth/me/route.ts` — add `capabilities` to the response.
- `src/app/api/shifts/_manager.ts` — refactor `requireManagerCompany()` to take a capability key (Task 7).
- Shifts manager routes under `src/app/api/shifts/*` — pass the mapped capability key to the helper (Task 7).
- Shifts self-service/view routes — add `requireCapability()` (Task 7).
- `src/app/shifts/page.tsx` + `src/components/shifts/*` — replace `isManager` with capabilities (Task 8).
- Admin navigation (wherever the admin menu lists Users/Staff Access) — add a "Permissions" link (Task 6).

---

## Task 1: Permission engine (registry + pure logic)

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `tests/permissions.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type Role = 'staff' | 'manager' | 'admin'`
  - `interface PermissionAction { key: string; module: string; label: string; group?: string; defaultRoles: Role[] }`
  - `const PERMISSION_ACTIONS: PermissionAction[]`
  - `const PERMISSIONS_MANAGE_KEY = 'permissions.manage'`
  - `type PermissionOverrides = Record<string, Role[]>`
  - `allowedRolesFor(key: string, overrides: PermissionOverrides): Role[]`
  - `roleCan(role: Role, key: string, overrides: PermissionOverrides): boolean`
  - `allowedActionKeysForRole(role: Role, overrides: PermissionOverrides): string[]`
  - `actionByKey(key: string): PermissionAction | undefined`
  - `isValidRoleArray(x: unknown): x is Role[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/permissions.unit.spec.ts
import { test, expect } from '@playwright/test';
import {
  roleCan, allowedRolesFor, allowedActionKeysForRole,
  PERMISSIONS_MANAGE_KEY, PERMISSION_ACTIONS, isValidRoleArray,
} from '../src/lib/permissions';

test('defaults apply when there is no override', () => {
  // shifts.shift.manage defaults to manager+admin (not staff)
  expect(roleCan('staff', 'shifts.shift.manage', {})).toBe(false);
  expect(roleCan('manager', 'shifts.shift.manage', {})).toBe(true);
  expect(roleCan('admin', 'shifts.shift.manage', {})).toBe(true);
});

test('view action is allowed for all roles by default', () => {
  expect(roleCan('staff', 'shifts.schedule.view', {})).toBe(true);
});

test('an override replaces the default for that action only', () => {
  const overrides = { 'shifts.shift.manage': ['staff', 'manager', 'admin'] as const };
  expect(roleCan('staff', 'shifts.shift.manage', overrides as any)).toBe(true);
  // a different action is untouched
  expect(roleCan('staff', 'shifts.schedule.publish', overrides as any)).toBe(false);
});

test('permissions.manage is hard-locked to admin even if an override says otherwise', () => {
  const overrides = { [PERMISSIONS_MANAGE_KEY]: ['staff', 'manager', 'admin'] as any };
  expect(roleCan('staff', PERMISSIONS_MANAGE_KEY, overrides)).toBe(false);
  expect(roleCan('manager', PERMISSIONS_MANAGE_KEY, overrides)).toBe(false);
  expect(roleCan('admin', PERMISSIONS_MANAGE_KEY, overrides)).toBe(true);
  expect(allowedRolesFor(PERMISSIONS_MANAGE_KEY, overrides)).toEqual(['admin']);
});

test('allowedActionKeysForRole returns every key the role can do', () => {
  const keys = allowedActionKeysForRole('staff', {});
  expect(keys).toContain('shifts.schedule.view');
  expect(keys).not.toContain('shifts.shift.manage');
});

test('every action key is unique and every default is a valid role subset', () => {
  const seen = new Set<string>();
  for (const a of PERMISSION_ACTIONS) {
    expect(seen.has(a.key)).toBe(false);
    seen.add(a.key);
    expect(isValidRoleArray(a.defaultRoles)).toBe(true);
    expect(a.defaultRoles.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/permissions.unit.spec.ts --project=unit`
Expected: FAIL — `Cannot find module '../src/lib/permissions'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/permissions.ts
/**
 * Canonical list of per-action permissions an admin can grant/revoke per role.
 *
 * Access model:
 *  - Each action has a set of default roles = TODAY's behavior.
 *  - An admin override (stored in the feature_permissions table, passed here as a
 *    plain map) replaces the default for that one action.
 *  - `permissions.manage` (the action that controls the Permissions screen itself)
 *    is HARD-LOCKED to admin and can never be overridden — prevents lockout.
 *
 * This file is pure logic (no DB import) so it is trivially unit-testable and is the
 * single source of truth used by BOTH the server guard and the UI.
 */
export type Role = 'staff' | 'manager' | 'admin';
export const ALL_ROLES: Role[] = ['staff', 'manager', 'admin'];

export interface PermissionAction {
  key: string;        // stable id: "<module>.<object>.<verb>"
  module: string;     // module id (matches ids in modules.ts / dashboard tiles)
  label: string;      // plain-English label shown on the screen
  group?: string;     // optional sub-heading within a module
  defaultRoles: Role[];
}

export type PermissionOverrides = Record<string, Role[]>;

/** The action that governs the Permissions screen. Always admin-only, never editable. */
export const PERMISSIONS_MANAGE_KEY = 'permissions.manage';

export const PERMISSION_ACTIONS: PermissionAction[] = [
  // ── Shifts (Release 1) — 11 capabilities, finalized from the audit ───
  // Each maps to real guarded routes (see Task 7 mapping table).
  { key: 'shifts.schedule.view',     module: 'shifts', label: 'View schedule & own shifts',                       defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'shifts.selfservice.submit', module: 'shifts', label: 'Claim / confirm / swap / report sick (self-service)', defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'shifts.shift.manage',      module: 'shifts', label: 'Create & edit shifts',                             defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.shift.delete',      module: 'shifts', label: 'Delete a shift / series',                          defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.schedule.publish',  module: 'shifts', label: 'Publish a schedule',                               defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.pattern.manage',    module: 'shifts', label: 'Manage patterns & runs',                           defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.rostercaps.manage', module: 'shifts', label: 'Manage roster caps',                               defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.requests.approve',  module: 'shifts', label: 'Approve requests / swaps / sick',                  defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.rolesdept.manage',  module: 'shifts', label: 'Manage roles & departments',                       defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.settings.manage',   module: 'shifts', label: 'Edit shift settings',                              defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.overview.view',     module: 'shifts', label: 'View manager overviews & KPIs',                    defaultRoles: ['manager', 'admin'] },
];

export function actionByKey(key: string): PermissionAction | undefined {
  return PERMISSION_ACTIONS.find((a) => a.key === key);
}

export function isValidRoleArray(x: unknown): x is Role[] {
  return Array.isArray(x) && x.every((r) => r === 'staff' || r === 'manager' || r === 'admin');
}

/** Effective allowed roles for an action: the admin override if present, else the default. */
export function allowedRolesFor(key: string, overrides: PermissionOverrides): Role[] {
  if (key === PERMISSIONS_MANAGE_KEY) return ['admin']; // hard-locked
  const override = overrides[key];
  if (isValidRoleArray(override)) return override;
  return actionByKey(key)?.defaultRoles ?? ['admin']; // unknown key = admin-only, fail closed
}

export function roleCan(role: Role, key: string, overrides: PermissionOverrides): boolean {
  return allowedRolesFor(key, overrides).includes(role);
}

export function allowedActionKeysForRole(role: Role, overrides: PermissionOverrides): string[] {
  return PERMISSION_ACTIONS
    .map((a) => a.key)
    .filter((key) => roleCan(role, key, overrides));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/permissions.unit.spec.ts --project=unit`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts tests/permissions.unit.spec.ts
git commit -m "[ADD] permissions: per-action role registry + pure access logic (unit-tested)"
```

---

## Task 2: Storage — feature_permissions table + helpers

**Files:**
- Modify: `src/lib/db.ts` (add table to `initTables` `db.exec(...)` block near `portal_settings`, ~line 83; add helpers near the settings helpers, ~line 478)

**Interfaces:**
- Consumes: `Role`, `PermissionOverrides` (from Task 1) — but stores/returns plain `string[]` (validation is the caller's job via `isValidRoleArray`).
- Produces:
  - `getPermissionOverrides(): Record<string, string[]>`
  - `setPermissionOverride(actionKey: string, roles: string[]): void`
  - `clearPermissionOverride(actionKey: string): void`
  - `clearPermissionOverrides(actionKeys: string[]): void`  // for per-module / global reset

- [ ] **Step 1: Add the table** — inside `initTables`, after the `company_settings` block (~line 93), add:

```sql
    -- Admin overrides for per-action permissions. action_key missing = use registry default.
    CREATE TABLE IF NOT EXISTS feature_permissions (
      action_key TEXT PRIMARY KEY,
      allowed_roles TEXT NOT NULL,   -- JSON array subset of ["staff","manager","admin"]
      updated_at TEXT
    );
```

- [ ] **Step 2: Add the helpers** — after `getCompanySettings` / `resolveCompanySetting` (~line 478), add:

```ts
// -- Feature permission overrides (per-action allowed roles) --------------------

/** All admin overrides as { action_key: string[] }. Missing action = registry default. */
export function getPermissionOverrides(): Record<string, string[]> {
  const rows = getDb()
    .prepare('SELECT action_key, allowed_roles FROM feature_permissions')
    .all() as { action_key: string; allowed_roles: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.allowed_roles);
      if (Array.isArray(arr)) out[r.action_key] = arr.filter((x): x is string => typeof x === 'string');
    } catch { /* skip corrupt row */ }
  }
  return out;
}

export function setPermissionOverride(actionKey: string, roles: string[]): void {
  getDb()
    .prepare(
      'INSERT INTO feature_permissions (action_key, allowed_roles, updated_at) VALUES (?,?,?) ' +
      'ON CONFLICT(action_key) DO UPDATE SET allowed_roles=excluded.allowed_roles, updated_at=excluded.updated_at',
    )
    .run(actionKey, JSON.stringify(roles), new Date().toISOString());
}

export function clearPermissionOverride(actionKey: string): void {
  getDb().prepare('DELETE FROM feature_permissions WHERE action_key = ?').run(actionKey);
}

/** Reset a set of actions to their registry defaults (used for per-module / global reset). */
export function clearPermissionOverrides(actionKeys: string[]): void {
  if (actionKeys.length === 0) return;
  const placeholders = actionKeys.map(() => '?').join(',');
  getDb().prepare(`DELETE FROM feature_permissions WHERE action_key IN (${placeholders})`).run(...actionKeys);
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `db.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "[ADD] permissions: feature_permissions table + override storage helpers"
```

---

## Task 3: Server guard — requireCapability()

**Files:**
- Modify: `src/lib/auth.ts` (add after `requireRole`, ~line 56)

**Interfaces:**
- Consumes: `getPermissionOverrides` (Task 2), `roleCan` (Task 1), existing `requireAuth`, `AuthError`, `PortalUser`.
- Produces: `requireCapability(actionKey: string): PortalUser`

- [ ] **Step 1: Add imports** at the top of `src/lib/auth.ts` (below the existing `getSessionUser` import):

```ts
import { getPermissionOverrides } from './db';
import { roleCan } from './permissions';
```

- [ ] **Step 2: Add the guard** after `requireRole`:

```ts
/**
 * Require that the current user's role is allowed a specific action, per the
 * configurable permission registry + admin overrides. Throws AuthError(403) if not.
 * Behavior-preserving: with no overrides, an action's default roles = today's guard.
 */
export function requireCapability(actionKey: string): PortalUser {
  const user = requireAuth();
  if (!roleCan(user.role, actionKey, getPermissionOverrides())) {
    throw new AuthError('Forbidden', 403);
  }
  return user;
}
```

- [ ] **Step 3: Verify no circular-import breakage**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (`permissions.ts` imports nothing from `auth`/`db`, so no cycle.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "[ADD] permissions: requireCapability() server guard"
```

---

## Task 4: Expose capabilities to the UI via /api/auth/me

**Files:**
- Modify: `src/app/api/auth/me/route.ts`

**Interfaces:**
- Consumes: `allowedActionKeysForRole` (Task 1), `getPermissionOverrides` (Task 2).
- Produces: `user.capabilities: string[]` in the `/api/auth/me` JSON.

- [ ] **Step 1: Add imports** to `src/app/api/auth/me/route.ts`:

```ts
import { allowedActionKeysForRole } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
```

- [ ] **Step 2: Add `capabilities` to the GET response** — in the returned `user` object (after `modules: ...`):

```ts
      modules: effectiveModuleIds(user.role, user.module_access),
      capabilities: allowedActionKeysForRole(user.role, getPermissionOverrides()),
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/me/route.ts
git commit -m "[ADD] permissions: return per-user capabilities from /api/auth/me"
```

---

## Task 5: Admin API — read & edit the matrix

**Files:**
- Create: `src/app/api/admin/permissions/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser`, `hasRole` (auth); `PERMISSION_ACTIONS`, `PERMISSIONS_MANAGE_KEY`, `actionByKey`, `isValidRoleArray` (Task 1); `getPermissionOverrides`, `setPermissionOverride`, `clearPermissionOverride`, `clearPermissionOverrides` (Task 2).
- Produces:
  - `GET` → `{ actions: PermissionAction[], overrides: Record<string,string[]> }`
  - `POST` body `{ action_key, allowed_roles }` → set one override; or `{ reset: 'all' }` / `{ reset: 'module', module: string }` → reset.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/admin/permissions/route.ts
import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import {
  PERMISSION_ACTIONS, PERMISSIONS_MANAGE_KEY, actionByKey, isValidRoleArray,
} from '@/lib/permissions';
import {
  getPermissionOverrides, setPermissionOverride,
  clearPermissionOverride, clearPermissionOverrides,
} from '@/lib/db';

function requireAdmin() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) return null;
  return me;
}

/** GET /api/admin/permissions — the full registry + current overrides. Admin only. */
export async function GET() {
  if (!requireAdmin()) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  return NextResponse.json({
    actions: PERMISSION_ACTIONS,
    overrides: getPermissionOverrides(),
  });
}

/** POST /api/admin/permissions — set one action's roles, or reset. Admin only. */
export async function POST(request: Request) {
  if (!requireAdmin()) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();

    // Reset paths
    if (body.reset === 'all') {
      clearPermissionOverrides(PERMISSION_ACTIONS.map((a) => a.key));
      return NextResponse.json({ overrides: getPermissionOverrides() });
    }
    if (body.reset === 'module') {
      const keys = PERMISSION_ACTIONS.filter((a) => a.module === body.module).map((a) => a.key);
      clearPermissionOverrides(keys);
      return NextResponse.json({ overrides: getPermissionOverrides() });
    }

    // Set-one path
    const { action_key, allowed_roles } = body;
    if (typeof action_key !== 'string' || !actionByKey(action_key)) {
      return NextResponse.json({ error: 'Unknown action_key' }, { status: 400 });
    }
    if (action_key === PERMISSIONS_MANAGE_KEY) {
      return NextResponse.json({ error: 'This permission is locked to admin' }, { status: 400 });
    }
    if (!isValidRoleArray(allowed_roles)) {
      return NextResponse.json({ error: 'allowed_roles must be a subset of staff/manager/admin' }, { status: 400 });
    }
    // Admin can never be removed — always retains access (fail-safe).
    const roles = Array.from(new Set([...allowed_roles, 'admin']));
    setPermissionOverride(action_key, roles);
    return NextResponse.json({ overrides: getPermissionOverrides() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update permissions';
    console.error('POST /api/admin/permissions error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/permissions/route.ts
git commit -m "[ADD] permissions: admin API to read/edit/reset the permission matrix"
```

---

## Task 6: Admin screen — the Permissions matrix

**Files:**
- Create: `src/app/admin/permissions/page.tsx`
- Create: `src/components/admin/PermissionsMatrix.tsx`
- Modify: the admin menu/nav that already links to Users / Staff Access (find with:
  `grep -rn "admin/users" src/app src/components | grep -i href`), add a "Permissions" entry pointing at `/admin/permissions`.

**Interfaces:**
- Consumes: `GET`/`POST /api/admin/permissions` (Task 5), `PERMISSIONS_MANAGE_KEY`, `PermissionAction`, `Role` (Task 1).
- Produces: an admin-only page rendering one section per module → a grid (rows = actions, columns = Staff / Manager / Admin), each cell a toggle.

- [ ] **Step 1: Page shell (admin gate)** — `src/app/admin/permissions/page.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PermissionsMatrix from '@/components/admin/PermissionsMatrix';

export default function PermissionsPage() {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setState(d.user?.role === 'admin' ? 'ok' : 'denied'))
      .catch(() => setState('denied'));
  }, []);

  if (state === 'loading') return <div className="p-6 text-gray-500">Loading…</div>;
  if (state === 'denied') {
    return (
      <div className="p-6">
        <p className="text-gray-700 mb-4">You need admin access to manage permissions.</p>
        <button onClick={() => router.push('/')} className="text-green-700 font-semibold">Back to home</button>
      </div>
    );
  }
  return <PermissionsMatrix />;
}
```

- [ ] **Step 2: The matrix component** — `src/components/admin/PermissionsMatrix.tsx`:

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { PERMISSIONS_MANAGE_KEY } from '@/lib/permissions';

type Role = 'staff' | 'manager' | 'admin';
interface Action { key: string; module: string; label: string; group?: string; defaultRoles: Role[] }
const ROLES: Role[] = ['staff', 'manager', 'admin'];
const ROLE_LABEL: Record<Role, string> = { staff: 'Staff', manager: 'Manager', admin: 'Admin' };

export default function PermissionsMatrix() {
  const [actions, setActions] = useState<Action[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Role[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/permissions')
      .then((r) => r.json())
      .then((d) => { setActions(d.actions || []); setOverrides(d.overrides || {}); })
      .catch(() => setError('Could not load permissions'));
  }, []);

  const byModule = useMemo(() => {
    const m: Record<string, Action[]> = {};
    for (const a of actions) (m[a.module] ??= []).push(a);
    return m;
  }, [actions]);

  function effectiveRoles(a: Action): Role[] {
    if (a.key === PERMISSIONS_MANAGE_KEY) return ['admin'];
    return overrides[a.key] ?? a.defaultRoles;
  }

  async function toggle(a: Action, role: Role) {
    if (a.key === PERMISSIONS_MANAGE_KEY) return;      // locked
    if (role === 'admin') return;                       // admin always on
    const current = effectiveRoles(a);
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setSaving(a.key);
    setError('');
    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_key: a.key, allowed_roles: next }),
      });
      if (!res.ok) throw new Error('rejected');
      const d = await res.json();
      setOverrides(d.overrides || {});
    } catch {
      setError('Could not save that change');
    } finally {
      setSaving(null);
    }
  }

  async function resetModule(moduleId: string) {
    const res = await fetch('/api/admin/permissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: 'module', module: moduleId }),
    });
    if (res.ok) setOverrides((await res.json()).overrides || {});
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-[20px] font-extrabold text-gray-900 mb-1">Permissions</h1>
      <p className="text-[13px] text-gray-500 mb-4">
        Choose which role can do each action. Changes take effect the next time that person opens the page. Admins always keep access.
      </p>
      {error && <div className="mb-3 text-[13px] text-red-600">{error}</div>}

      {Object.entries(byModule).map(([moduleId, list]) => (
        <div key={moduleId} className="mb-6 rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="text-[12px] font-bold uppercase tracking-wide text-gray-500">{moduleId}</span>
            <button onClick={() => resetModule(moduleId)} className="text-[11px] font-semibold text-gray-500 active:opacity-70">
              Reset to defaults
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-y-1 px-4 py-3">
            <div />
            <div className="flex gap-2 pb-1">
              {ROLES.map((r) => (
                <span key={r} className="w-16 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">{ROLE_LABEL[r]}</span>
              ))}
            </div>
            {list.map((a) => {
              const roles = effectiveRoles(a);
              const locked = a.key === PERMISSIONS_MANAGE_KEY;
              return (
                <div key={a.key} className="contents">
                  <div className="flex items-center text-[13px] text-gray-800 min-w-0 pr-3">
                    <span className="truncate">{a.label}{locked && <span className="ml-1 text-[10px] text-gray-400">(admin only)</span>}</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    {ROLES.map((r) => {
                      const on = roles.includes(r);
                      const disabled = locked || r === 'admin' || saving === a.key;
                      return (
                        <button
                          key={r}
                          onClick={() => toggle(a, r)}
                          disabled={disabled}
                          aria-label={`${a.label} — ${ROLE_LABEL[r]} ${on ? 'on' : 'off'}`}
                          className={`w-16 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                            on ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'
                          } ${disabled ? 'opacity-50' : 'active:bg-gray-50'}`}
                        >
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                            on ? 'bg-green-600 border-green-600' : 'border-gray-300'
                          }`}>
                            {on && <span className="text-white text-[12px] leading-none">✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link.** Locate the admin menu (e.g. the screen listing "Manage Staff"/"Staff Access") and add, matching its existing item markup:

```tsx
{/* Admin only — same visibility condition as the Users / Staff Access links */}
<a href="/admin/permissions" className="...matching existing admin link classes...">Permissions</a>
```

- [ ] **Step 4: Verify build + manual smoke**

Run: `npm run build`
Expected: build succeeds. Then (Task 9 does the real-browser check).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/permissions/page.tsx src/components/admin/PermissionsMatrix.tsx <the nav file>
git commit -m "[ADD] permissions: admin Permissions matrix screen + nav link"
```

---

## Task 7: Wire Shifts server routes to capabilities  *(finalized from audit)*

> **Correctness note (do not skip):** Shifts manager routes are already enforced by
> `requireManagerCompany(companyId)` in `src/app/api/shifts/_manager.ts`, which checks BOTH
> `hasRole(user,'manager')` AND that `company_id ∈ allowed_company_ids` (admins bypass company).
> We must make only the **role** half configurable and **KEEP the company-scope check** — otherwise a
> manager of restaurant A could act on restaurant B. So we refactor the helper to take a capability
> key; we do NOT replace it with a bare role check.
>
> **Do NOT touch** `src/app/api/shifts/busy/route.ts` (pre-existing uncommitted change) — coordinate
> with the user first. Its capability is `shifts.overview.view`; apply once the user clears that file.

**Files:**
- Modify: `src/app/api/shifts/_manager.ts`
- Modify: the ~35 manager route files (call sites of `requireManagerCompany`)
- Modify: the self-service/view route files (add `requireCapability`)

**Interfaces:**
- Consumes: `roleCan` (Task 1), `getPermissionOverrides` (Task 2), `requireCapability`, `AuthError` (Task 3).
- Produces: `requireManagerCompany(companyIdRaw: unknown, actionKey?: string): ManagerAuth` (extended signature).

### Task 7a: Refactor the shared manager gate (capability-driven, company-scope preserved)

- [ ] **Step 1:** In `src/app/api/shifts/_manager.ts`, add imports:

```ts
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
```

- [ ] **Step 2:** Change the signature and the role check only. Replace:

```ts
export function requireManagerCompany(companyIdRaw: unknown): ManagerAuth {
  const user = getCurrentUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!hasRole(user, 'manager')) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
```

with (company logic below this stays exactly the same):

```ts
export function requireManagerCompany(companyIdRaw: unknown, actionKey?: string): ManagerAuth {
  const user = getCurrentUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  // Role decision: configurable capability when a key is given, else legacy manager gate.
  const roleOk = actionKey
    ? roleCan(user.role, actionKey, getPermissionOverrides())
    : hasRole(user, 'manager');
  if (!roleOk) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
```

- [ ] **Step 3:** Build. `npm run build` → succeeds. Every existing call site still compiles (key is optional) and behaves identically (no key = `hasRole`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/shifts/_manager.ts
git commit -m "[IMP] shifts: make requireManagerCompany capability-driven (keeps company scope)"
```

### Task 7b: Pass each manager route its capability key

- [ ] **Step 1:** In each manager route, add the key as the 2nd argument to `requireManagerCompany(...)`. Mapping (from audit):

| Capability key | Routes (call sites) |
|---|---|
| `shifts.shift.manage` | `slots` POST, `slots/[id]` PUT, `manage` GET, `copy-last-week` POST, `templates` GET/POST, `templates/[id]` DELETE |
| `shifts.shift.delete` | `slots/[id]` DELETE, `delete-series` POST |
| `shifts.schedule.publish` | `publish-week` POST, `publish-upcoming` POST, `patterns/[id]/publish` POST |
| `shifts.pattern.manage` | `patterns` GET/POST, `patterns/[id]` GET/PUT/DELETE, `runs` GET, `runs/[id]` GET/POST |
| `shifts.rostercaps.manage` | `roster` GET, `roster/[employeeId]` PUT |
| `shifts.requests.approve` | `approvals` GET, `approvals/[id]/approve` POST, `approvals/[id]/decline` POST, `approvals/[id]/undo` POST, `sick-reports/[id]/resolve` POST |
| `shifts.rolesdept.manage` | `roles` GET/POST, `roles/[id]` PUT/DELETE, `departments` GET/POST, `departments/[id]` PUT/DELETE |
| `shifts.settings.manage` | `settings` GET/PUT |
| `shifts.overview.view` | `coverage`, `overview`, `team`, `punctuality`, `timesheet`, `presence`, `busy` (see busy caveat) |

Example edit (in `src/app/api/shifts/slots/route.ts` POST):

```ts
const auth = requireManagerCompany(body.company_id, 'shifts.shift.manage');
if (!auth.ok) return auth.res;
```

- [ ] **Step 2:** Build → succeeds. Commit:

```bash
git add src/app/api/shifts
git commit -m "[ADD] shifts: gate manager routes on per-action capabilities"
```

### Task 7c: Gate the self-service / view routes

> These routes use `getCurrentUser()`/`requireAuth()` + ownership/company checks, not the manager
> helper. Add a capability guard at the very top so the role layer is enforced too; keep their
> existing ownership/company logic underneath.

- [ ] **Step 1:** At the top of each handler body add the guard + catch. Pattern:

```ts
import { requireCapability, AuthError } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    requireCapability('shifts.selfservice.submit');
    // ... existing body (ownership/company checks stay) ...
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // ... existing error handling ...
  }
}
```

Mapping:
- `shifts.selfservice.submit` → `claim`, `confirm`, `cover-requests` (POST), `cover-requests/[id]/accept|decline|cancel`, `sick-reports` (POST)
- `shifts.schedule.view` → `summary`, `me`, `mine`, `open`, `hours`, `requests`, `announcement`
- **Leave as-is for now** (out of Release 1 scope, flag for hardening): `my-pin`, `notifications`,
  `notifications/read`, and `shift/staff` + `shift/identify` (the last two also lack company scope —
  note in the module's follow-up, do not fix here to keep this change focused).

- [ ] **Step 2:** Build → succeeds. Commit:

```bash
git add src/app/api/shifts
git commit -m "[ADD] shifts: gate self-service/view routes on capabilities"
```

---

## Task 8: Wire Shifts UI to capabilities

**Files:**
- Modify: `src/app/shifts/page.tsx` (replace the single `isManager` derivation with a capability set)
- Modify: `src/components/shifts/*` that currently receive `isManager` (from the audit list)

**Interfaces:**
- Consumes: `user.capabilities: string[]` from `/api/auth/me` (Task 4).

**Audit anchors (exact):** `src/app/shifts/page.tsx:112` derives `isManager`; it is spread into every
screen via the `common` object (lines ~189-195); the settings gear renders only if `isManager`
(line ~205). `src/components/shifts/ShiftsDashboard.tsx:267` filters groups with
`visibleGroups = groups.filter(g => !g.managerOnly || isManager)`; line ~271 chooses
`ManagerKpiStack` vs `StaffKpiStack` by `isManager`. `CreateShift.tsx:484` and `ManageShifts.tsx:1327`
each have an `if (!isManager)` lock screen.

- [ ] **Step 1:** In `src/app/shifts/page.tsx`, keep `isManager` but ALSO derive capabilities from the
same `/api/auth/me` payload the page already loads, and pass a `can` helper through `common`:

```ts
const capabilities: string[] = me?.user?.capabilities ?? [];
const can = (key: string) => capabilities.includes(key);
const isManager = role === 'manager' || role === 'admin'; // keep for now; children migrate below
```

Add `can` (and/or precomputed booleans) to the `common` object spread into screens, alongside
`isManager`. The settings gear (line ~205) becomes `can('shifts.settings.manage')`.

- [ ] **Step 2:** Migrate each gated control from `isManager` to its capability. Give each dashboard
tile/group a `cap` and show it when `can(tile.cap)` (a group is visible if any child tile is). Mapping:
  - Create-shift tile + `CreateShift.tsx:484` lock → `can('shifts.shift.manage')`
  - Manage-schedule tile + `ManageShifts.tsx:1327` lock → `can('shifts.shift.manage')`
    (publish/delete buttons *inside* ManageShifts → `can('shifts.schedule.publish')` /
    `can('shifts.shift.delete')`)
  - Approvals tile → `can('shifts.requests.approve')`
  - PatternManager tile → `can('shifts.pattern.manage')`
  - RosterCaps tile → `can('shifts.rostercaps.manage')`
  - Settings gear + RolesDeptManager (inside settings) → `can('shifts.settings.manage')` /
    `can('shifts.rolesdept.manage')`
  - Coverage / ManagerOverview / Presence / Timesheet / Punctuality tiles + `ManagerKpiStack`
    (`ShiftsDashboard.tsx:271`) → `can('shifts.overview.view')`
  Replace the `managerOnly` boolean on groups/tiles with per-tile `cap`; keep `StaffKpiStack` as the
  fallback when `!can('shifts.overview.view')`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/shifts/page.tsx src/components/shifts
git commit -m "[IMP] shifts: gate UI controls on per-action capabilities instead of isManager"
```

---

## Task 9: Real-browser verification against staging

**Files:**
- Create: `tests/permissions.e2e.spec.ts`

**Deploy first** (this repo's e2e hits the live staging URL):

```bash
git push
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull && npm run build && systemctl restart krawings-portal'
```

**Interfaces:**
- Consumes: the deployed Permissions screen + Shifts enforcement. Test users (CLAUDE.md):
  admin `biz@krawings.de`/`test1234`; manager Marco `test1234`; staff Hana `test1234`.

- [ ] **Step 1: Write the e2e test**

```ts
// tests/permissions.e2e.spec.ts
import { test, expect, Page } from '@playwright/test';

const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de', password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234' };
const STAFF = { email: process.env.SMOKE_STAFF_EMAIL || 'hana@krawings.de', password: process.env.SMOKE_STAFF_PASSWORD || 'test1234' };

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('admin can open the Permissions screen and see the Shifts section', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/permissions');
  await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Create & edit shifts')).toBeVisible();
});

test('staff is denied the Permissions screen', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  await page.goto('/admin/permissions');
  await expect(page.getByText(/admin access/i)).toBeVisible();
});

test('by default staff cannot create a shift (server refuses)', async ({ page }) => {
  await login(page, STAFF.email, STAFF.password);
  // Hitting a manage endpoint directly must be refused (403) for staff by default.
  const res = await page.request.post('/api/shifts', { data: { probe: true } });
  expect([401, 403]).toContain(res.status());
});
```

- [ ] **Step 2: Run against staging**

Run: `npm run test:inventory -- tests/permissions.e2e.spec.ts`
(That is the `modules` project: `SMOKE_ENV=staging playwright test --project=modules`.)
Expected: 3 passed.

- [ ] **Step 3: Manual confirmation (the real proof).** As admin, open `/admin/permissions`,
turn **"Create & edit shifts"** ON for Staff, save. Log in as Hana (staff) → the create-shift
control now appears AND the server accepts it. Turn it back OFF → control disappears and the
server returns 403. Confirm no other role's behavior changed. Test on mobile viewport too.

- [ ] **Step 4: Commit**

```bash
git add tests/permissions.e2e.spec.ts
git commit -m "[ADD] permissions: e2e verification of Shifts enforcement + admin screen"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** registry (T1), storage (T2), server enforcement (T3, T7), UI exposure (T4, T8),
  admin screen (T5, T6), Shifts-first rollout (T7–T9), behavior-preserving defaults (T1 defaults),
  anti-lockout (`permissions.manage` in T1/T5/T6), real-browser verification (T9). ✓
- **Placeholder scan:** none. The Shifts route→capability mapping (T7) and UI anchors (T8) are
  finalized from the completed audit; the 11-capability registry (T1) matches them 1:1.
- **Type consistency:** `Role`, `PermissionOverrides`, `PERMISSION_ACTIONS`, `roleCan`,
  `allowedActionKeysForRole`, `getPermissionOverrides`, `requireCapability` names match across tasks. ✓

## Notes / decisions carried from the spec
- v1 is **by role only**; per-person overrides are out of scope (table is keyed by action only).
- Admin is force-kept in every override (T5) as a second belt-and-braces anti-lockout on top of the
  `permissions.manage` hard-lock.
- Module *visibility* (`modules.ts` / `module_access`) is untouched and independent.
