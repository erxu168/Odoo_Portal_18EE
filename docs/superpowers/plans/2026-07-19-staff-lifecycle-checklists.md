# Staff Lifecycle Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portal-native Joining / Promotion / Leaving checklists to the HR module — base + team add-on lists, promotion-by-level, per-task responsible, optional phone-push reminders — with data living in the portal SQLite and Odoo read-only.

**Architecture:** A pure-logic module (`staffing-logic.ts`, unit-tested) does merging and date math; a SQLite data module (`staffing-checklist-db.ts`) owns four tables plus CRUD, snapshot/merge on start, and reminder queries. Thin Next.js API routes under `/api/staffing/*` call the data module and use Odoo only to read employee context (team, manager, dates, level). React components in `src/components/hr/*` render Setup, the two-section checklist, the journey timeline, the start prompt, and the employee self-view. An hourly cron route sends due reminders via the existing `sendPushToUser`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, better-sqlite3, `web-push`, Odoo 18 EE JSON-RPC (`src/lib/odoo.ts`), Playwright (`unit` project for pure functions; smoke specs for flows).

## Global Constraints

- **Single branch:** all work on `main`. No side branches.
- **Berlin time for business dates:** never use `toISOString()` for dates shown to users; use the Berlin helper `nowISO()` / date-only `todayBerlinISO()`. (Odoo dates use a space separator, not `T`.)
- **Odoo is read-only** here — no writes to Odoo from this feature. All Odoo calls server-side through `src/lib/odoo.ts` (`getOdoo()`), never from the browser.
- **Reminders** go through `sendPushToUser(userId, payload)` from `src/lib/push.ts`. Reminder audience = portal users resolved via `getUserByEmployeeId()`.
- **Cron** routes are guarded by `?token=<CRON_SECRET>` (env `CRON_SECRET`), matching `src/app/api/cron/shift-confirm-reminders/route.ts`.
- **Gating:** master-template APIs = `requireRole('admin')`; running/ticking Business tasks = `requireRole('manager')`; Employee tasks = the employee (staff) or their manager. Role hierarchy Staff < Manager < Admin.
- **Company-scoped** throughout: every template and instance carries `company_id`; use the caller's active company.
- **Mobile-first**, Krawings design system (`DESIGN_GUIDE.md`): dark header, orange `#F5800A` primary action, semantic badges (never colour alone), `var(--fs-*)` type. New components are PascalCase files under `src/components/hr/`; no monoliths.
- **Build hygiene:** `err: unknown` + `instanceof` in catches; unused params prefixed `_`; JSX apostrophes as `’`; `Array.from()` not set-spread; run `npm run build` (never piped) before every commit that touches TS.
- **Snapshot rule:** starting a checklist copies tasks into the instance; later template edits never rewrite live instances.

---

## Codex cross-check corrections (binding)

A read-only Codex (`gpt-5.6-sol`, high) reviewed this plan. Accepted corrections — apply these; they override anything looser below:

1. **Level field = `hr.employee.x_skill_level`** with stable codes `'1'=Trainee`, `'2'=Associate`, `'3'=Team Lead`. Do **not** use `hr.job`/`job_title`. Promotion = an **upward** change (`1→2`, `1→3`, `2→3`). `null/false→level`, unchanged, and demotions do **not** trigger.
2. **Promotion trigger lives in the Roster editor, not EmployeeForm.** Detect it in `src/app/api/shifts/roster/[employeeId]/route.ts` (skill written at ~line 120) using the old `skill` already loaded before the write; return a `promotion_offer` **only after the `x_skill_level` write succeeds**. Note: that route currently *swallows* addon-field write failures and still returns success — for the skill write, treat a failed core write as an error so a checklist is never offered for a promotion that did not happen. `src/components/shifts/RosterCaps.tsx` renders the shared `StartChecklistPrompt` from the returned offer.
3. **Leaving trigger fires after termination confirmation**, not on draft creation. `src/components/termination/TermWizard.tsx` already calls `onCreated(id)`; `src/app/termination/page.tsx` (the `onCreated` handler, ~line 104) owns the prompt before navigating to `detail`.
4. **Reuse `berlinToday()` from `src/lib/berlin-date.ts`** for "today" — do not add a second Berlin-date helper. `staffing-logic.ts` stays pure (callers pass `todayISO`).
5. **Company-scope is authorization, not a filter.** Every route: require a positive `company_id`, validate with `canAccessCompany(user, companyId)` from `src/lib/inventory-access.ts`, load records by **both** `id` and `company_id`, and **re-read** the employee/`kw.termination` from Odoo to confirm its company. Never trust the client company cookie for authz. (Several existing `/api/termination/*` routes lack this — do not inherit that weakness.)
6. **Capabilities, not a new module id.** Add to `src/lib/permissions.ts` `PERMISSION_ACTIONS`: `staffing.templates.manage` (admin), `staffing.instances.manage` (manager, admin), `staffing.tasks.manage` (manager, admin). Gate routes with `requireCapability(key)`. Do **not** add a `staffing_checklists` id to `modules.ts` (it would vanish for users with an explicit allowlist); it lives under module `hr`.
7. **Start idempotency:** instances carry a server-generated `start_key` with a `UNIQUE` index; a repeated start returns the existing instance instead of a duplicate. Keep the "one open instance per stage" guard too.
8. **Assignee resolution & fallbacks:**
   - Always store `assignee_employee_id`; `assignee_user_id` may be null (a new hire has no portal account yet). `/my-tasks` and the cron resolve the current active portal user by employee id at read time (`getUserByEmployeeId`) rather than relying only on the stored `assignee_user_id`.
   - `employee_manager` with no portal account → fall back to a **deterministic active admin for that company**; if none, fail the start with an actionable `409` (never create orphaned manager tasks). The start route resolves this admin and passes it as `adminUserId`.
   - `specific_user`: validate active + company-eligible when saving the template and again at start; surface "Assignee unavailable" if later deactivated (do not silently reassign).
9. **Joining reference date:** `first_contract_date` → else a **manager-confirmed date** in `StartChecklistPrompt` defaulting to Berlin today (employee creation does not set a contract date, so the prompt must expose a date field).
10. **Setup-incomplete is explicit:** missing required base (joining/leaving) or missing promotion target template → `409 Setup incomplete`; a merge of **zero** active tasks must **not** create an empty instance. Missing team add-on is fine → base only.
11. **Reminder cron is claim-then-send (at-most-once).** Fail closed `503` if `CRON_SECRET` is unset; reject a wrong token. For each due task, **atomically claim** the stage (`UPDATE ... SET reminder_stage=? WHERE id=? AND status='pending' AND reminder_stage<? AND EXISTS(open instance)`), send **only if `changes===1`**. This replaces the shift cron's "send-then-mark" (concurrent runs would double-send). Gate sends to 09:00–21:00 Berlin (no 3am pushes); a missing subscription still counts as claimed (no hourly retry). True exactly-once is out of scope (documented).
12. **Schema hardening:** `CHECK` constraints for `stage/scope/audience/responsible_type/status` and booleans; partial `UNIQUE` indexes (one base per `(company_id,stage)`; one team per `(company_id,stage,department_id)`; one promotion per `(company_id,target_level)`); a reminder-scan index on `(status,reminder,due_date,reminder_stage)`; portal-user FKs `ON DELETE SET NULL`, task children `ON DELETE CASCADE`. Snapshot `department_name` onto the instance for history.
13. **New endpoints** (added to File Structure): `GET /api/staffing/checklists/preview` (counts + reference date + resolution warnings, creates nothing — powers the prompt's "6 base + 3 Kitchen = 9"); `GET /api/staffing/assignees?company_id=` (company-scoped active user picker); `POST /api/staffing/templates/[id]/tasks/reorder` (atomic bulk reorder).

Deferred (noted, not built in v1): reminder outbox/retry table (accept at-most-once); richer "assignee unavailable" reassignment UI.

---

## File Structure

**New:**
- `src/types/staffing.ts` — shared types (stages, scopes, rows, inputs).
- `src/lib/staffing-logic.ts` — pure functions: merge, date math, due-state, reminder-stage. Unit-tested.
- `src/lib/staffing-checklist-db.ts` — 4 tables + CRUD + `startInstance` (merge/resolve/snapshot) + reminder queries.
- `src/app/api/staffing/templates/route.ts` — GET list, POST create (admin).
- `src/app/api/staffing/templates/[id]/route.ts` — GET, PATCH, DELETE (admin).
- `src/app/api/staffing/templates/[id]/tasks/route.ts` — GET, POST (admin).
- `src/app/api/staffing/templates/[id]/tasks/[taskId]/route.ts` — PATCH, DELETE (admin).
- `src/app/api/staffing/templates/[id]/tasks/reorder/route.ts` — POST atomic bulk reorder (admin) *(Correction §13)*.
- `src/app/api/staffing/assignees/route.ts` — GET `?company_id=` company-scoped active-user picker *(Correction §13)*.
- `src/app/api/staffing/checklists/preview/route.ts` — GET merge preview (counts, reference date, warnings; creates nothing) *(Correction §13)*.
- `src/app/api/staffing/checklists/route.ts` — GET `?employee_id=`, POST start.
- `src/app/api/staffing/checklists/[id]/route.ts` — GET one.
- `src/app/api/staffing/checklists/[id]/tasks/[taskId]/route.ts` — PATCH tick/skip/note.
- `src/app/api/staffing/checklists/[id]/cancel/route.ts` — POST cancel.
- `src/app/api/staffing/my-tasks/route.ts` — GET employee's own pending tasks.
- `src/app/api/cron/staffing-checklist-reminders/route.ts` — GET hourly reminder job.
- `src/components/hr/ChecklistSetup.tsx`, `ChecklistTemplateEditor.tsx`, `EmployeeJourney.tsx`, `EmployeeChecklistView.tsx`, `StartChecklistPrompt.tsx`, `MyLifecycleTasks.tsx`.
- `tests/staffing-logic.unit.spec.ts` — pure-function unit tests.

**Modified:**
- `src/app/hr/page.tsx` — new `Screen` cases + nav wiring.
- `src/components/hr/HrDashboard.tsx` — "Checklist Setup" manager tile; surface "Your tasks".
- `src/components/hr/EmployeeDetail.tsx` — journey timeline + checklist cards + "Start checklist".
- `src/components/hr/EmployeeForm.tsx` — offer Joining checklist after create.
- The termination create screen (`src/app/termination/page.tsx` or its form component — locate in Task 15) — offer Leaving checklist.
- The staff-management level editor (locate in Task 17) — offer Promotion checklist on level-up.

---

# Phase 1 — Data & logic core

### Task 1: Shared types

**Files:**
- Create: `src/types/staffing.ts`

**Interfaces:**
- Produces: `Stage`, `Scope`, `Audience`, `ResponsibleType`, `TaskStatus`, `InstanceStatus`, `DueState`, `TemplateRow`, `TemplateTaskRow`, `InstanceRow`, `InstanceTaskRow`, `TemplateTaskSeed`, and input types used by every later task.

- [ ] **Step 1: Write the types file**

```ts
// src/types/staffing.ts
export type Stage = 'joining' | 'promotion' | 'leaving';
export type Scope = 'base' | 'team' | 'level';
export type Audience = 'business' | 'employee';
export type ResponsibleType = 'specific_user' | 'employee_manager' | 'the_employee';
export type TaskStatus = 'pending' | 'done' | 'skipped';
export type InstanceStatus = 'open' | 'done' | 'cancelled';
export type DueState = 'none' | 'upcoming' | 'due_soon' | 'overdue' | 'done';

export interface TemplateRow {
  id: number;
  company_id: number;
  stage: Stage;
  scope: Scope;
  department_id: number | null;   // scope='team'
  target_level: string | null;    // scope='level' (e.g. '2','3' or 'associate')
  name: string;
  active: number;                 // 0|1
  created_at: string;
  updated_at: string;
}

export interface TemplateTaskRow {
  id: number;
  template_id: number;
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  responsible_type: ResponsibleType;
  responsible_user_id: number | null;   // portal user id, when specific_user
  due_offset_days: number | null;
  reminder: number;                      // 0|1
  active: number;
}

export interface InstanceRow {
  id: number;
  employee_id: number;
  company_id: number;
  stage: Stage;
  department_id: number | null;
  target_level: string | null;
  from_level: string | null;
  reference_date: string;               // YYYY-MM-DD
  status: InstanceStatus;
  started_by: number;
  started_at: string;
  termination_id: number | null;
}

export interface InstanceTaskRow {
  id: number;
  instance_id: number;
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  source: Scope;
  assignee_user_id: number | null;
  assignee_employee_id: number | null;
  due_date: string | null;              // YYYY-MM-DD
  reminder: number;
  status: TaskStatus;
  done_by: number | null;
  done_at: string | null;
  note: string | null;
  reminder_stage: number;               // 0..3
}

/** A template task flattened for merging into an instance. */
export interface TemplateTaskSeed {
  audience: Audience;
  title: string;
  description: string | null;
  sequence: number;
  responsible_type: ResponsibleType;
  responsible_user_id: number | null;
  due_offset_days: number | null;
  reminder: boolean;
  source: Scope;
}

export interface CreateTemplateInput {
  company_id: number;
  stage: Stage;
  scope: Scope;
  department_id?: number | null;
  target_level?: string | null;
  name: string;
}

export interface UpsertTemplateTaskInput {
  audience: Audience;
  title: string;
  description?: string | null;
  sequence?: number;
  responsible_type: ResponsibleType;
  responsible_user_id?: number | null;
  due_offset_days?: number | null;
  reminder?: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `src/types/staffing.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/staffing.ts
git commit -m "[ADD] hr: staffing checklist types"
```

---

### Task 2: Pure logic — merge, dates, due-state, reminder-stage

**Files:**
- Create: `src/lib/staffing-logic.ts`
- Test: `tests/staffing-logic.unit.spec.ts`

**Interfaces:**
- Consumes: types from `src/types/staffing.ts`.
- Produces: `mergeTaskSeeds(base, addon)`, `addDaysISO(dateISO, days)`, `computeDueDate(refISO, offset)`, `dueState({status,dueDate,todayISO,dueSoonDays?})`, `reminderStageDue(dueDateISO, todayISO, leadDays?)`, `todayBerlinISO()`.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/staffing-logic.unit.spec.ts
import { test, expect } from '@playwright/test';
import {
  mergeTaskSeeds, addDaysISO, computeDueDate, dueState, reminderStageDue,
} from '../src/lib/staffing-logic';
import type { TemplateTaskSeed } from '../src/types/staffing';

function seed(p: Partial<TemplateTaskSeed>): TemplateTaskSeed {
  return {
    audience: 'business', title: 't', description: null, sequence: 0,
    responsible_type: 'employee_manager', responsible_user_id: null,
    due_offset_days: null, reminder: false, source: 'base', ...p,
  };
}

test('mergeTaskSeeds keeps base before addon and re-sequences per audience', () => {
  const base = [seed({ title: 'B1', audience: 'business', sequence: 5, source: 'base' }),
                seed({ title: 'E1', audience: 'employee', sequence: 9, source: 'base' })];
  const addon = [seed({ title: 'B2', audience: 'business', sequence: 0, source: 'team' })];
  const merged = mergeTaskSeeds(base, addon);
  const biz = merged.filter(s => s.audience === 'business');
  expect(biz.map(s => s.title)).toEqual(['B1', 'B2']);
  expect(biz.map(s => s.sequence)).toEqual([0, 1]);
  expect(merged.find(s => s.title === 'B2')!.source).toBe('team');
});

test('addDaysISO adds calendar days', () => {
  expect(addDaysISO('2026-07-19', 7)).toBe('2026-07-26');
  expect(addDaysISO('2026-02-27', 2)).toBe('2026-03-01'); // 2026 not leap
});

test('computeDueDate is null when offset is null', () => {
  expect(computeDueDate('2026-07-19', null)).toBeNull();
  expect(computeDueDate('2026-07-19', 3)).toBe('2026-07-22');
});

test('dueState classifies pending tasks', () => {
  expect(dueState({ status: 'done', dueDate: '2026-07-01', todayISO: '2026-07-19' })).toBe('done');
  expect(dueState({ status: 'pending', dueDate: null, todayISO: '2026-07-19' })).toBe('none');
  expect(dueState({ status: 'pending', dueDate: '2026-07-10', todayISO: '2026-07-19' })).toBe('overdue');
  expect(dueState({ status: 'pending', dueDate: '2026-07-21', todayISO: '2026-07-19' })).toBe('due_soon');
  expect(dueState({ status: 'pending', dueDate: '2026-08-30', todayISO: '2026-07-19' })).toBe('upcoming');
});

test('reminderStageDue escalates lead -> due-day -> overdue', () => {
  expect(reminderStageDue('2026-07-25', '2026-07-19')).toBe(0); // >3 days away
  expect(reminderStageDue('2026-07-22', '2026-07-19')).toBe(1); // within lead window
  expect(reminderStageDue('2026-07-19', '2026-07-19')).toBe(2); // due today
  expect(reminderStageDue('2026-07-17', '2026-07-19')).toBe(3); // overdue
  expect(reminderStageDue(null, '2026-07-19')).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/staffing-logic.unit.spec.ts`
Expected: FAIL — cannot find module `../src/lib/staffing-logic`.

- [ ] **Step 3: Write the implementation**

> **Correction §4:** do NOT define a `todayBerlinISO()` here — reuse `berlinToday()` from `@/lib/berlin-date`. `staffing-logic.ts` stays pure; callers pass `todayISO`. (The unit test below passes `todayISO` explicitly, so this module needs no clock.)

```ts
// src/lib/staffing-logic.ts
import type { TemplateTaskSeed, Audience, DueState, TaskStatus } from '@/types/staffing';

/** Add N calendar days to a YYYY-MM-DD string; returns YYYY-MM-DD. Uses UTC math to avoid DST drift. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function computeDueDate(referenceDateISO: string, offsetDays: number | null): string | null {
  if (offsetDays == null) return null;
  return addDaysISO(referenceDateISO, offsetDays);
}

/** Base tasks first, then add-on tasks; re-sequenced 0..n within each audience section. */
export function mergeTaskSeeds(base: TemplateTaskSeed[], addon: TemplateTaskSeed[]): TemplateTaskSeed[] {
  const out: TemplateTaskSeed[] = [];
  for (const audience of ['business', 'employee'] as Audience[]) {
    const rows = [
      ...base.filter(s => s.audience === audience).sort((a, b) => a.sequence - b.sequence),
      ...addon.filter(s => s.audience === audience).sort((a, b) => a.sequence - b.sequence),
    ];
    rows.forEach((s, i) => out.push({ ...s, sequence: i }));
  }
  return out;
}

export function dueState(params: {
  status: TaskStatus; dueDate: string | null; todayISO: string; dueSoonDays?: number;
}): DueState {
  const { status, dueDate, todayISO, dueSoonDays = 3 } = params;
  if (status === 'done' || status === 'skipped') return 'done';
  if (!dueDate) return 'none';
  if (dueDate < todayISO) return 'overdue';
  if (dueDate === todayISO) return 'due_soon';
  if (addDaysISO(todayISO, dueSoonDays) >= dueDate) return 'due_soon';
  return 'upcoming';
}

/** Highest reminder stage that should have fired: 0 none, 1 lead, 2 due-day, 3 overdue. */
export function reminderStageDue(dueDateISO: string | null, todayISO: string, leadDays = 3): number {
  if (!dueDateISO) return 0;
  if (dueDateISO < todayISO) return 3;
  if (dueDateISO === todayISO) return 2;
  if (addDaysISO(todayISO, leadDays) >= dueDateISO) return 1;
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/staffing-logic.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/staffing-logic.ts tests/staffing-logic.unit.spec.ts
git commit -m "[ADD] hr: pure staffing-logic (merge, dates, due-state, reminders)"
```

---

### Task 3: Data module — tables + template/task CRUD

**Files:**
- Create: `src/lib/staffing-checklist-db.ts`

**Interfaces:**
- Consumes: `getDb` from `@/lib/db`; types from `@/types/staffing`.
- Produces: `createTemplate`, `listTemplates`, `getTemplate`, `updateTemplate`, `deleteTemplate`, `listTemplateTasks`, `addTemplateTask`, `updateTemplateTask`, `deleteTemplateTask`, `findBaseTemplate`, `findTeamTemplate`, `findLevelTemplate`, plus `ensureStaffingTables` (internal).

> **Apply Corrections §12 + §7 to this schema:** add `CHECK` constraints (`stage`, `scope`, `audience`, `responsible_type`, `status`, booleans in `(0,1)`); partial `UNIQUE` indexes — `WHERE scope='base'` on `(company_id,stage)`, `WHERE scope='team'` on `(company_id,stage,department_id)`, `WHERE scope='level'` on `(company_id,target_level)`; a reminder-scan index on `staffing_instance_tasks(status,reminder,due_date,reminder_stage)`; a `UNIQUE` `start_key` column on `staffing_instances`; a snapshot `department_name` column on `staffing_instances`; portal-user FK columns documented `ON DELETE SET NULL` (better-sqlite3 enforces FKs — `PRAGMA foreign_keys` is ON in `db.ts`), task children `ON DELETE CASCADE` (already shown).

- [ ] **Step 1: Write the schema + template CRUD**

```ts
// src/lib/staffing-checklist-db.ts
import { getDb } from './db';
import type {
  TemplateRow, TemplateTaskRow, InstanceRow, InstanceTaskRow,
  CreateTemplateInput, UpsertTemplateTaskInput, Stage,
} from '@/types/staffing';

/** Berlin timestamp (matches issues-db / kds-db). Never toISOString(). */
function nowISO(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(' ', 'T');
}

let _init = false;
function ensureStaffingTables(): void {
  if (_init) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS staffing_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      scope TEXT NOT NULL,
      department_id INTEGER,
      target_level TEXT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_tpl_scope
      ON staffing_templates(company_id, stage, scope);

    CREATE TABLE IF NOT EXISTS staffing_template_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES staffing_templates(id) ON DELETE CASCADE,
      audience TEXT NOT NULL DEFAULT 'business',
      title TEXT NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      responsible_type TEXT NOT NULL DEFAULT 'employee_manager',
      responsible_user_id INTEGER,
      due_offset_days INTEGER,
      reminder INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_tpl_tasks ON staffing_template_tasks(template_id);

    CREATE TABLE IF NOT EXISTS staffing_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      department_id INTEGER,
      target_level TEXT,
      from_level TEXT,
      reference_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      started_by INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      termination_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_emp ON staffing_instances(employee_id);

    CREATE TABLE IF NOT EXISTS staffing_instance_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES staffing_instances(id) ON DELETE CASCADE,
      audience TEXT NOT NULL DEFAULT 'business',
      title TEXT NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'base',
      assignee_user_id INTEGER,
      assignee_employee_id INTEGER,
      due_date TEXT,
      reminder INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      done_by INTEGER,
      done_at TEXT,
      note TEXT,
      reminder_stage INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_staffing_inst_tasks ON staffing_instance_tasks(instance_id);
  `);
  _init = true;
}

export function createTemplate(input: CreateTemplateInput): number {
  ensureStaffingTables();
  const now = nowISO();
  const r = getDb().prepare(`
    INSERT INTO staffing_templates
      (company_id, stage, scope, department_id, target_level, name, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(input.company_id, input.stage, input.scope,
         input.department_id ?? null, input.target_level ?? null, input.name, now, now);
  return Number(r.lastInsertRowid);
}

export function listTemplates(companyId: number): TemplateRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_templates WHERE company_id = ? AND active = 1
     ORDER BY stage, scope, name`,
  ).all(companyId) as TemplateRow[];
}

export function getTemplate(id: number): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare('SELECT * FROM staffing_templates WHERE id = ?').get(id) as TemplateRow) || null;
}

export function updateTemplate(id: number, patch: Partial<Pick<TemplateRow, 'name' | 'active'>>): void {
  ensureStaffingTables();
  const cur = getTemplate(id);
  if (!cur) return;
  getDb().prepare('UPDATE staffing_templates SET name = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(patch.name ?? cur.name, patch.active ?? cur.active, nowISO(), id);
}

export function deleteTemplate(id: number): void {
  ensureStaffingTables();
  getDb().prepare('DELETE FROM staffing_templates WHERE id = ?').run(id);
}

export function listTemplateTasks(templateId: number): TemplateTaskRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_template_tasks WHERE template_id = ? AND active = 1
     ORDER BY audience, sequence, id`,
  ).all(templateId) as TemplateTaskRow[];
}

export function addTemplateTask(templateId: number, t: UpsertTemplateTaskInput): number {
  ensureStaffingTables();
  const r = getDb().prepare(`
    INSERT INTO staffing_template_tasks
      (template_id, audience, title, description, sequence, responsible_type,
       responsible_user_id, due_offset_days, reminder, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(templateId, t.audience, t.title, t.description ?? null, t.sequence ?? 0,
         t.responsible_type, t.responsible_user_id ?? null,
         t.due_offset_days ?? null, t.reminder ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function updateTemplateTask(taskId: number, t: UpsertTemplateTaskInput): void {
  ensureStaffingTables();
  getDb().prepare(`
    UPDATE staffing_template_tasks SET
      audience = ?, title = ?, description = ?, sequence = ?, responsible_type = ?,
      responsible_user_id = ?, due_offset_days = ?, reminder = ?
    WHERE id = ?
  `).run(t.audience, t.title, t.description ?? null, t.sequence ?? 0, t.responsible_type,
         t.responsible_user_id ?? null, t.due_offset_days ?? null, t.reminder ? 1 : 0, taskId);
}

export function deleteTemplateTask(taskId: number): void {
  ensureStaffingTables();
  getDb().prepare('DELETE FROM staffing_template_tasks WHERE id = ?').run(taskId);
}

export function findBaseTemplate(companyId: number, stage: Stage): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates
     WHERE company_id = ? AND stage = ? AND scope = 'base' AND active = 1 LIMIT 1`,
  ).get(companyId, stage) as TemplateRow) || null;
}

export function findTeamTemplate(companyId: number, stage: Stage, departmentId: number): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates
     WHERE company_id = ? AND stage = ? AND scope = 'team' AND department_id = ? AND active = 1 LIMIT 1`,
  ).get(companyId, stage, departmentId) as TemplateRow) || null;
}

export function findLevelTemplate(companyId: number, targetLevel: string): TemplateRow | null {
  ensureStaffingTables();
  return (getDb().prepare(
    `SELECT * FROM staffing_templates
     WHERE company_id = ? AND stage = 'promotion' AND scope = 'level' AND target_level = ? AND active = 1 LIMIT 1`,
  ).get(companyId, targetLevel) as TemplateRow) || null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/staffing-checklist-db.ts
git commit -m "[ADD] hr: staffing checklist tables + template CRUD"
```

---

### Task 4: Data module — start instance (merge + resolve + snapshot), read, tick

**Files:**
- Modify: `src/lib/staffing-checklist-db.ts` (append)

**Interfaces:**
- Consumes: `getUserByEmployeeId` from `@/lib/db`; `mergeTaskSeeds`, `computeDueDate` from `@/lib/staffing-logic`.
- Produces:
  - `startInstance(params: StartInstanceParams): number`
  - `getInstancesForEmployee(employeeId): InstanceRow[]`
  - `getInstance(id): { instance: InstanceRow; tasks: InstanceTaskRow[] } | null`
  - `setTaskStatus(taskId, { status, done_by, note }): void`
  - `cancelInstance(id): void`
  - `getMyPendingEmployeeTasks(employeeId): (InstanceTaskRow & { stage: Stage })[]`
  - `StartInstanceParams` type.

> **Apply Corrections §7 + §8:** `startInstance` takes a `startKey`; on `UNIQUE` conflict return the existing instance id (no duplicate). Always store `assignee_employee_id`. For `employee_manager` with no portal account, use the route-resolved `adminUserId`; the route must resolve a deterministic active company admin and, if none exists, return `409` rather than passing `null` (no orphaned tasks). If the merged seed list is empty, do **not** insert an instance — throw a typed "setup incomplete" error the route maps to `409`.

- [ ] **Step 1: Append start/read/tick logic**

```ts
// --- append to src/lib/staffing-checklist-db.ts ---
import { getUserByEmployeeId } from './db';
import { mergeTaskSeeds, computeDueDate } from './staffing-logic';
import type { TemplateTaskSeed, TaskStatus } from '@/types/staffing';

export interface StartInstanceParams {
  employeeId: number;
  companyId: number;
  stage: Stage;
  departmentId: number | null;   // joining/leaving
  targetLevel: string | null;    // promotion
  fromLevel: string | null;      // promotion history
  referenceDate: string;         // YYYY-MM-DD
  startedBy: number;             // portal user id
  terminationId: number | null;
  managerEmployeeId: number | null;
  adminUserId: number | null;    // fallback assignee for employee_manager
}

function seedsFrom(row: { id: number; scope: Scope }): TemplateTaskSeed[] {
  return listTemplateTasks(row.id).map(t => ({
    audience: t.audience, title: t.title, description: t.description, sequence: t.sequence,
    responsible_type: t.responsible_type, responsible_user_id: t.responsible_user_id,
    due_offset_days: t.due_offset_days, reminder: !!t.reminder, source: row.scope,
  }));
}

/** Resolve a seed's responsible into (assignee_user_id, assignee_employee_id). */
function resolveAssignee(
  seed: TemplateTaskSeed, p: StartInstanceParams,
): { assignee_user_id: number | null; assignee_employee_id: number | null } {
  if (seed.responsible_type === 'specific_user') {
    return { assignee_user_id: seed.responsible_user_id, assignee_employee_id: null };
  }
  if (seed.responsible_type === 'the_employee') {
    const u = getUserByEmployeeId(p.employeeId);
    return { assignee_user_id: u?.id ?? null, assignee_employee_id: p.employeeId };
  }
  // employee_manager
  if (p.managerEmployeeId != null) {
    const u = getUserByEmployeeId(p.managerEmployeeId);
    if (u) return { assignee_user_id: u.id, assignee_employee_id: p.managerEmployeeId };
  }
  return { assignee_user_id: p.adminUserId, assignee_employee_id: null };
}

export function startInstance(p: StartInstanceParams): number {
  ensureStaffingTables();
  // Gather seeds by stage.
  let seeds: TemplateTaskSeed[] = [];
  if (p.stage === 'promotion') {
    const lvl = p.targetLevel ? findLevelTemplate(p.companyId, p.targetLevel) : null;
    seeds = lvl ? seedsFrom(lvl) : [];
  } else {
    const base = findBaseTemplate(p.companyId, p.stage);
    const team = p.departmentId != null ? findTeamTemplate(p.companyId, p.stage, p.departmentId) : null;
    seeds = mergeTaskSeeds(base ? seedsFrom(base) : [], team ? seedsFrom(team) : []);
  }

  const db = getDb();
  const tx = db.transaction(() => {
    const inst = db.prepare(`
      INSERT INTO staffing_instances
        (employee_id, company_id, stage, department_id, target_level, from_level,
         reference_date, status, started_by, started_at, termination_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(p.employeeId, p.companyId, p.stage, p.departmentId, p.targetLevel, p.fromLevel,
           p.referenceDate, p.startedBy, nowISO(), p.terminationId);
    const instanceId = Number(inst.lastInsertRowid);
    const insTask = db.prepare(`
      INSERT INTO staffing_instance_tasks
        (instance_id, audience, title, description, sequence, source,
         assignee_user_id, assignee_employee_id, due_date, reminder, status, reminder_stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
    `);
    for (const s of seeds) {
      const who = resolveAssignee(s, p);
      insTask.run(instanceId, s.audience, s.title, s.description, s.sequence, s.source,
        who.assignee_user_id, who.assignee_employee_id,
        computeDueDate(p.referenceDate, s.due_offset_days), s.reminder ? 1 : 0);
    }
    return instanceId;
  });
  return tx();
}

export function getInstancesForEmployee(employeeId: number): InstanceRow[] {
  ensureStaffingTables();
  return getDb().prepare(
    `SELECT * FROM staffing_instances WHERE employee_id = ? ORDER BY started_at DESC`,
  ).all(employeeId) as InstanceRow[];
}

export function getInstance(id: number): { instance: InstanceRow; tasks: InstanceTaskRow[] } | null {
  ensureStaffingTables();
  const instance = getDb().prepare('SELECT * FROM staffing_instances WHERE id = ?').get(id) as InstanceRow | undefined;
  if (!instance) return null;
  const tasks = getDb().prepare(
    `SELECT * FROM staffing_instance_tasks WHERE instance_id = ? ORDER BY audience, sequence, id`,
  ).all(id) as InstanceTaskRow[];
  return { instance, tasks };
}

export function setTaskStatus(
  taskId: number, p: { status: TaskStatus; done_by: number | null; note?: string | null },
): void {
  ensureStaffingTables();
  const doneAt = p.status === 'pending' ? null : nowISO();
  const db = getDb();
  db.prepare(
    `UPDATE staffing_instance_tasks SET status = ?, done_by = ?, done_at = ?, note = COALESCE(?, note) WHERE id = ?`,
  ).run(p.status, p.status === 'pending' ? null : p.done_by, doneAt, p.note ?? null, taskId);
  // Auto-close the instance when no pending tasks remain.
  const row = db.prepare('SELECT instance_id FROM staffing_instance_tasks WHERE id = ?').get(taskId) as { instance_id: number } | undefined;
  if (row) {
    const pending = db.prepare(
      `SELECT COUNT(*) AS n FROM staffing_instance_tasks WHERE instance_id = ? AND status = 'pending'`,
    ).get(row.instance_id) as { n: number };
    db.prepare(`UPDATE staffing_instances SET status = ? WHERE id = ? AND status != 'cancelled'`)
      .run(pending.n === 0 ? 'done' : 'open', row.instance_id);
  }
}

export function cancelInstance(id: number): void {
  ensureStaffingTables();
  getDb().prepare(`UPDATE staffing_instances SET status = 'cancelled' WHERE id = ?`).run(id);
}

export function getMyPendingEmployeeTasks(employeeId: number): (InstanceTaskRow & { stage: Stage })[] {
  ensureStaffingTables();
  return getDb().prepare(`
    SELECT t.*, i.stage AS stage
    FROM staffing_instance_tasks t
    JOIN staffing_instances i ON i.id = t.instance_id
    WHERE t.assignee_employee_id = ? AND t.audience = 'employee'
      AND t.status = 'pending' AND i.status = 'open'
    ORDER BY (t.due_date IS NULL), t.due_date, t.sequence
  `).all(employeeId) as (InstanceTaskRow & { stage: Stage })[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/staffing-checklist-db.ts
git commit -m "[ADD] hr: start/merge/snapshot + read + tick for checklists"
```

---

# Phase 2 — Template management (admin)

### Task 5: Templates + tasks API routes (admin)

**Files:**
- Create: `src/app/api/staffing/templates/route.ts`
- Create: `src/app/api/staffing/templates/[id]/route.ts`
- Create: `src/app/api/staffing/templates/[id]/tasks/route.ts`
- Create: `src/app/api/staffing/templates/[id]/tasks/[taskId]/route.ts`

**Interfaces:**
- Consumes: `requireRole` + `AuthError` from `@/lib/auth`; template CRUD from `@/lib/staffing-checklist-db`.
- Produces: REST endpoints used by `ChecklistSetup` / `ChecklistTemplateEditor`.

- [ ] **Step 1: Templates collection route**

```ts
// src/app/api/staffing/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { createTemplate, listTemplates } from '@/lib/staffing-checklist-db';
import type { CreateTemplateInput } from '@/types/staffing';

export async function GET(req: NextRequest) {
  try {
    requireRole('admin');
    const companyId = Number(new URL(req.url).searchParams.get('company_id'));
    if (!companyId) return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    return NextResponse.json({ templates: listTemplates(companyId) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET templates', err);
    return NextResponse.json({ error: 'Failed to load checklists' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireRole('admin');
    const b = (await req.json()) as CreateTemplateInput;
    if (!b.company_id || !b.stage || !b.scope || !b.name?.trim()) {
      return NextResponse.json({ error: 'company_id, stage, scope and name are required' }, { status: 400 });
    }
    if (b.scope === 'team' && !b.department_id) {
      return NextResponse.json({ error: 'Pick a team for a team add-on.' }, { status: 400 });
    }
    if (b.scope === 'level' && !b.target_level) {
      return NextResponse.json({ error: 'Pick a target level for a promotion list.' }, { status: 400 });
    }
    const id = createTemplate({ ...b, name: b.name.trim() });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST templates', err);
    return NextResponse.json({ error: 'Failed to create checklist' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Single template route**

```ts
// src/app/api/staffing/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { getTemplate, updateTemplate, deleteTemplate, listTemplateTasks } from '@/lib/staffing-checklist-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('admin');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ template: tpl, tasks: listTemplateTasks(tpl.id) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('admin');
    const b = await req.json();
    updateTemplate(Number(params.id), { name: b.name, active: b.active });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('admin');
    deleteTemplate(Number(params.id));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Template tasks routes**

```ts
// src/app/api/staffing/templates/[id]/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { addTemplateTask, listTemplateTasks } from '@/lib/staffing-checklist-db';
import type { UpsertTemplateTaskInput } from '@/types/staffing';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('admin');
    return NextResponse.json({ tasks: listTemplateTasks(Number(params.id)) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('admin');
    const b = (await req.json()) as UpsertTemplateTaskInput;
    if (!b.title?.trim() || !b.audience || !b.responsible_type) {
      return NextResponse.json({ error: 'title, audience and responsible are required' }, { status: 400 });
    }
    const id = addTemplateTask(Number(params.id), { ...b, title: b.title.trim() });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

```ts
// src/app/api/staffing/templates/[id]/tasks/[taskId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { updateTemplateTask, deleteTemplateTask } from '@/lib/staffing-checklist-db';
import type { UpsertTemplateTaskInput } from '@/types/staffing';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    requireRole('admin');
    const b = (await req.json()) as UpsertTemplateTaskInput;
    updateTemplateTask(Number(params.taskId), { ...b, title: (b.title || '').trim() });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    requireRole('admin');
    deleteTemplateTask(Number(params.taskId));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles; the four new routes appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/staffing/templates
git commit -m "[ADD] hr: staffing template + task admin API routes"
```

---

### Task 6: Checklist Setup + Template Editor screens

**Files:**
- Create: `src/components/hr/ChecklistSetup.tsx`
- Create: `src/components/hr/ChecklistTemplateEditor.tsx`
- Modify: `src/app/hr/page.tsx` (add `checklist-setup` + `checklist-template` screens)
- Modify: `src/components/hr/HrDashboard.tsx` (admin "Checklist Setup" tile)

**Interfaces:**
- Consumes: templates API (Task 5); `AppHeader`; the responsible-person picker needs the company's portal users — reuse the existing users source used by `EmployeePortalAccess` / an existing `/api/admin/users` list (confirm the exact endpoint while wiring; it already exists for the permissions screen).
- Produces: `ChecklistSetup` (props `{ onBack; onHome; onOpen(templateId:number|null) }`), `ChecklistTemplateEditor` (props `{ templateId; onBack; onHome; onSaved }`).

- [ ] **Step 1: `ChecklistSetup.tsx`** — fetches `GET /api/staffing/templates?company_id=<active>`, groups rows by `stage` into three sections (Joining / Promotion / Leaving), renders base rows with a `base` badge and team/level rows beneath, each showing its task count (from `GET /api/staffing/templates/[id]`), plus a "+ New checklist" flow that POSTs a template. Use `AppHeader title="Checklist Setup"`, cards per DESIGN_GUIDE. On row tap → `onOpen(id)`.

```tsx
// src/components/hr/ChecklistSetup.tsx  (structure — style per DESIGN_GUIDE)
'use client';
import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import type { TemplateRow, Stage } from '@/types/staffing';

const STAGE_ORDER: { key: Stage; label: string }[] = [
  { key: 'joining', label: 'Joining' },
  { key: 'promotion', label: 'Promotion' },
  { key: 'leaving', label: 'Leaving' },
];

export default function ChecklistSetup({ onBack, onHome, onOpen }: {
  onBack: () => void; onHome: () => void; onOpen: (id: number | null) => void;
}) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(me => {
      const companyId = me.user?.active_company_id || me.user?.company_id; // use active company helper already in the app
      return fetch(`/api/staffing/templates?company_id=${companyId}`);
    }).then(r => r.json()).then(d => setRows(d.templates || [])).finally(() => setLoading(false));
  }, []);
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Checklist Setup" subtitle="Admins only" showBack onBack={onBack} />
      {/* three sections mapped from STAGE_ORDER; base first (badge), then team/level rows; onClick -> onOpen(row.id) */}
      {/* bottom ghost button -> onOpen(null) opens the editor in create mode */}
    </div>
  );
}
```

- [ ] **Step 2: `ChecklistTemplateEditor.tsx`** — loads `GET /api/staffing/templates/[id]`, lists tasks in two audience sections, and an add/edit task form matching the mock: title, audience segmented control, responsible select (`specific_user` → user picker; `employee_manager`; `the_employee`), optional deadline day-count, reminder toggle. Save → POST/PATCH tasks; reorder via sequence. For a team/level template, show the "adds on top of the base" note.

- [ ] **Step 3: Wire screens into `src/app/hr/page.tsx`** — add `{ type: 'checklist-setup' }` and `{ type: 'checklist-template'; templateId: number | null }` to the `Screen` union and `switch`, plus a `handleDashboardNav` case `'checklist-setup'`.

- [ ] **Step 4: Add the admin tile in `HrDashboard.tsx`** — in the Manager Tools grid, add a tile `id: 'checklist-setup'` visible when `role === 'admin'`, `onClick: () => onNavigate('checklist-setup')`, icon = clipboard, label "Checklist Setup", sub "Hire, promote & leave".

- [ ] **Step 5: Build + manual verify**

Run: `npm run build`
Then (staging or `npm run dev`): as an admin, open HR → Checklist Setup → create a `joining/base` "Every new hire" with 2 tasks (1 business, 1 employee), a `joining/team` Kitchen add-on with 1 task, and a `promotion/level` "→ Team Lead". Confirm they list under the right stages with correct counts.

- [ ] **Step 6: Commit**

```bash
git add src/components/hr/ChecklistSetup.tsx src/components/hr/ChecklistTemplateEditor.tsx src/app/hr/page.tsx src/components/hr/HrDashboard.tsx
git commit -m "[ADD] hr: Checklist Setup + template editor screens"
```

---

# Phase 3 — Start & work a checklist (Joining)

### Task 7: Employee-context helper (Odoo read)

**Files:**
- Create: `src/lib/staffing-odoo.ts`

**Interfaces:**
- Consumes: `getOdoo` from `@/lib/odoo`.
- Produces: `getEmployeeContext(employeeId): Promise<{ companyId:number; departmentId:number|null; managerEmployeeId:number|null; firstContractDate:string|null; level:string|null; name:string }>`. Reads `hr.employee` fields `company_id, department_id, parent_id, first_contract_date, x_skill_level, name`. `level` = the confirmed level field (see Task 16 note; default `x_skill_level` as string).

- [ ] **Step 1: Implement the reader** (single `searchRead`, m2o → id via `Array.isArray(v) ? v[0] : null`, date `first_contract_date` already `YYYY-MM-DD`).
- [ ] **Step 2: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 3: Commit** `[ADD] hr: employee-context reader for checklists`.

---

### Task 8: Start / read / tick / cancel checklist API

**Files:**
- Create: `src/app/api/staffing/checklists/route.ts` (GET `?employee_id=`, POST start)
- Create: `src/app/api/staffing/checklists/[id]/route.ts` (GET one)
- Create: `src/app/api/staffing/checklists/[id]/tasks/[taskId]/route.ts` (PATCH)
- Create: `src/app/api/staffing/checklists/[id]/cancel/route.ts` (POST)

**Interfaces:**
- Consumes: `requireRole`, `getCurrentUser`; `getEmployeeContext` (Task 7); `startInstance`, `getInstancesForEmployee`, `getInstance`, `setTaskStatus`, `cancelInstance` (Task 4); `getAccountByEmployeeId`/admin id source for `adminUserId`.
- Produces: endpoints for `StartChecklistPrompt`, `EmployeeChecklistView`, `EmployeeJourney`.

- [ ] **Step 1: POST start** — `requireRole('manager')`; body `{ employee_id, stage, department_id?, target_level?, from_level?, reference_date?, termination_id? }`. Resolve context via `getEmployeeContext`; `referenceDate = body.reference_date ?? (stage==='joining' ? ctx.firstContractDate : todayBerlinISO())`; `departmentId = body.department_id ?? ctx.departmentId`; `adminUserId` = the acting admin's id or a configured fallback; call `startInstance(...)`; return `{ id }`. Guard: refuse to start a second **open** instance of the same stage for the same employee (query `getInstancesForEmployee` first) → 409 with a clear message.

```ts
// src/app/api/staffing/checklists/route.ts (POST body of the handler)
const user = requireRole('manager');
const b = await req.json();
const ctx = await getEmployeeContext(Number(b.employee_id));
const stage = b.stage as Stage;
const referenceDate = b.reference_date
  || (stage === 'joining' ? ctx.firstContractDate : todayBerlinISO())
  || todayBerlinISO();
const existing = getInstancesForEmployee(Number(b.employee_id))
  .find(i => i.stage === stage && i.status === 'open');
if (existing) return NextResponse.json({ error: 'A checklist for this stage is already open.', id: existing.id }, { status: 409 });
const id = startInstance({
  employeeId: Number(b.employee_id), companyId: ctx.companyId, stage,
  departmentId: b.department_id ?? ctx.departmentId,
  targetLevel: b.target_level ?? null, fromLevel: b.from_level ?? null,
  referenceDate, startedBy: user.id, terminationId: b.termination_id ?? null,
  managerEmployeeId: ctx.managerEmployeeId, adminUserId: user.role === 'admin' ? user.id : null,
});
return NextResponse.json({ id }, { status: 201 });
```

- [ ] **Step 2: GET list** — `requireRole('manager')`, `?employee_id=`; return `getInstancesForEmployee(id)` each with `{ total, done }` counts (query per instance or a COUNT join) for the journey timeline.
- [ ] **Step 3: GET one** — `requireRole('manager')`; `getInstance(id)`; 404 if null.
- [ ] **Step 4: PATCH task** — allow if `requireRole('manager')` **or** the task's `assignee_employee_id === currentUser.employee_id` (employee ticking their own). Body `{ status, note? }`; call `setTaskStatus(taskId, { status, done_by: user.id, note })`.
- [ ] **Step 5: POST cancel** — `requireRole('manager')`; `cancelInstance(id)`.
- [ ] **Step 6: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 7: Commit** `[ADD] hr: checklist start/read/tick/cancel API`.

---

### Task 9: Start prompt + checklist view + journey on EmployeeDetail

**Files:**
- Create: `src/components/hr/StartChecklistPrompt.tsx`
- Create: `src/components/hr/EmployeeChecklistView.tsx`
- Create: `src/components/hr/EmployeeJourney.tsx`
- Modify: `src/components/hr/EmployeeDetail.tsx`
- Modify: `src/app/hr/page.tsx`

**Interfaces:**
- `StartChecklistPrompt` props `{ employeeId; stage; defaultDepartmentId?; targetLevel?; onStarted(id); onClose }` — modal dialog (overlay `z-[100]+`, `max-h-[90vh] overflow-y-auto` per portal convention). For joining/leaving shows a team select; POSTs `/api/staffing/checklists`.
- `EmployeeChecklistView` props `{ instanceId; canManage; currentEmployeeId; onBack; onHome }` — loads `GET /api/staffing/checklists/[id]`, renders Business + Employee sections, ticks via PATCH; badges via `dueState()` + `todayBerlinISO()`.
- `EmployeeJourney` props `{ employeeId; onOpenChecklist(id) }` — loads `GET /api/staffing/checklists?employee_id=`, renders the timeline + a progress card per instance, and a "Start checklist" action that opens `StartChecklistPrompt`.

- [ ] **Step 1:** Build `StartChecklistPrompt` (modal, team select, POST, 409 handling shows "already open, open it?").
- [ ] **Step 2:** Build `EmployeeChecklistView` (two sections, tick, badges, overdue red / due-soon amber, done strike-through).
- [ ] **Step 3:** Build `EmployeeJourney` (timeline nodes done/now, progress cards, start action).
- [ ] **Step 4:** Mount `EmployeeJourney` inside `EmployeeDetail` (manager view) and add a `checklist-view` screen to `hr/page.tsx` navigating to `EmployeeChecklistView`.
- [ ] **Step 5: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 6: Manual verify** — open an employee (manager), Start → Joining, confirm base+team merge and both sections, tick a task, see progress update; overdue/due-soon badges render.
- [ ] **Step 7: Commit** `[ADD] hr: start prompt, checklist view, journey timeline`.

---

### Task 10: Joining trigger on employee create

**Files:**
- Modify: `src/components/hr/EmployeeForm.tsx`

**Interfaces:**
- Consumes: the create response `{ employee: { id } }` and `StartChecklistPrompt`.

- [ ] **Step 1:** After a successful **create** (not edit), instead of navigating away immediately, render `StartChecklistPrompt` with `stage='joining'`, `defaultDepartmentId` = the chosen department. On `onStarted`/`onClose`, continue the existing `onSaved` navigation.
- [ ] **Step 2: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 3: Manual verify** — add a new employee → the joining prompt appears → start → lands on the new employee with the checklist present.
- [ ] **Step 4: Commit** `[ADD] hr: offer joining checklist after adding an employee`.

---

# Phase 4 — Employee self-view

### Task 11: `my-tasks` API + dashboard surface

**Files:**
- Create: `src/app/api/staffing/my-tasks/route.ts`
- Create: `src/components/hr/MyLifecycleTasks.tsx`
- Modify: `src/components/hr/HrDashboard.tsx`, `src/app/hr/page.tsx`

**Interfaces:**
- `GET /api/staffing/my-tasks` → `requireAuth()`; if `user.employee_id` null → `{ tasks: [] }`; else `getMyPendingEmployeeTasks(user.employee_id)` mapped to `{ id, instance_id, title, due_date, reminder }`.
- `MyLifecycleTasks` props `{ onOpen(instanceId) }` — shows the staff member's own pending tasks with due badges + a reminder chip.

- [ ] **Step 1:** Implement the route.
- [ ] **Step 2:** Build `MyLifecycleTasks`; surface it on the staff HR dashboard (a "Your tasks" card above the tiles when the count > 0). Tapping a task opens its `EmployeeChecklistView` (employee can tick their own via the PATCH rule in Task 8).
- [ ] **Step 3: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 4: Manual verify** — log in as the test staff user whose employee has a joining checklist; see the Employee tasks; tick one; it disappears from "to do".
- [ ] **Step 5: Commit** `[ADD] hr: employee self-view of lifecycle tasks`.

---

# Phase 5 — Leaving trigger

### Task 12: Offer Leaving checklist when a termination is created

**Files:** (per Correction §3 — after confirmation, not on draft creation)
- Modify: `src/app/termination/page.tsx` — the `onCreated(id)` handler (~line 104) owns the prompt before it navigates to `detail`.
- (`src/components/termination/TermWizard.tsx` already calls `onCreated(id)` on confirmation — no change needed unless it must also surface `employee_id`/`last_working_day`; pass those through if not already available to the page.)

**Interfaces:**
- Consumes: the confirmed `kw.termination` id (+ employee_id, last_working_day) and `StartChecklistPrompt`.

- [ ] **Step 1:** In the `onCreated` handler, render `StartChecklistPrompt` with `stage='leaving'`, `defaultDepartmentId` = the employee's department, `termination_id` = the id. The **start route re-reads `kw.termination`** (Correction §5) and uses `last_working_day` (fallback `letter_date`, then `berlinToday()`) as the reference date, so deadlines count from the last working day.
- [ ] **Step 2: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 3: Manual verify** — start a termination → leaving prompt → start → leave checklist present with base+team tasks; deadlines relative to the last working day.
- [ ] **Step 4: Commit** `[ADD] hr: offer leaving checklist on termination`.

---

# Phase 6 — Promotion

### Task 13: Trigger promotion on level-up (Roster editor)

Per Corrections §1 + §2 — the level field is `x_skill_level` (`'1'`/`'2'`/`'3'`) and the change happens in the Roster editor, not EmployeeForm.

**Files:**
- Modify: `src/app/api/shifts/roster/[employeeId]/route.ts` — return a `promotion_offer` after the skill write.
- Modify: `src/components/shifts/RosterCaps.tsx` — render `StartChecklistPrompt` from the offer.

**Interfaces:**
- Consumes: the old `skill` already loaded in the roster route before the write; `StartChecklistPrompt` (`stage='promotion'`).
- Produces: PUT response gains an optional `promotion_offer: { employee_id, target_level, from_level } | null`.

- [ ] **Step 1: Fix the swallowed-write bug for skill.** In the roster route, the core `hr.employee` write (currently ~line 120) must be treated as required for the skill change — if it throws, return an error; do **not** proceed to offer a promotion. (Addon-only field failures may still be tolerated, but the `x_skill_level` write must succeed before any offer.)
- [ ] **Step 2:** Capture `fromLevel = oldSkill` (already loaded), `toLevel = body.skill`. After the write succeeds, compute `upward = toLevel && fromLevel && Number(toLevel) > Number(fromLevel)`. Set `promotion_offer = upward ? { employee_id, target_level: toLevel, from_level: fromLevel } : null`. `null/false→level`, unchanged, and demotions yield `null`.
- [ ] **Step 3:** In `RosterCaps.tsx`, when the PUT response has a `promotion_offer`, render `StartChecklistPrompt` with `stage='promotion'`, `target_level`, `from_level`. Start uses `reference_date = today` (the change's effective date). The journey timeline (Task 9) renders the new promotion instance.
- [ ] **Step 4: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 5: Manual verify** — set up a `promotion/level` list with `target_level='2'`; in Roster change a trainee (`'1'`) to `'2'` → promotion prompt → start → journey shows Joined → Promoted; step-up tasks present. Changing `'2'`→`'1'` (demotion) shows no prompt.
- [ ] **Step 6: Commit** `[ADD] hr: promotion checklist on level-up (roster)`.

---

# Phase 7 — Reminders

### Task 14: Reminder cron

**Files:**
- Modify: `src/lib/staffing-checklist-db.ts` (append `listReminderCandidates`, `markReminderStage`)
- Create: `src/app/api/cron/staffing-checklist-reminders/route.ts`

**Interfaces:**
- Consumes: `reminderStageDue`, `todayBerlinISO` (Task 2); `sendPushToUser` (`@/lib/push`).
- Produces: `listReminderCandidates(): (InstanceTaskRow & { stage: Stage; employee_id: number })[]`, `markReminderStage(taskId, stage)`.

- [ ] **Step 1: Append DB queries**

```ts
// append to src/lib/staffing-checklist-db.ts
export function listReminderCandidates(): (InstanceTaskRow & { stage: Stage; employee_id: number })[] {
  ensureStaffingTables();
  // NOTE: no assignee_user_id filter — employee tasks may have a null stored user
  // (new hire not yet provisioned); the cron resolves the live user by employee id.
  return getDb().prepare(`
    SELECT t.*, i.stage AS stage, i.employee_id AS employee_id
    FROM staffing_instance_tasks t
    JOIN staffing_instances i ON i.id = t.instance_id
    WHERE t.status = 'pending' AND t.reminder = 1 AND t.due_date IS NOT NULL
      AND i.status = 'open'
  `).all() as (InstanceTaskRow & { stage: Stage; employee_id: number })[];
}

/** Atomically claim a reminder stage (Correction §11). Returns true only if THIS call advanced it. */
export function claimReminderStage(taskId: number, stage: number): boolean {
  ensureStaffingTables();
  const r = getDb().prepare(`
    UPDATE staffing_instance_tasks SET reminder_stage = ?
    WHERE id = ? AND status = 'pending' AND reminder_stage < ?
      AND EXISTS (SELECT 1 FROM staffing_instances i WHERE i.id = instance_id AND i.status = 'open')
  `).run(stage, taskId, stage);
  return r.changes === 1;
}
```

- [ ] **Step 2: Cron route** — guard `token === process.env.CRON_SECRET` else 401 (mirror `shift-confirm-reminders`). For each candidate, `stageNow = reminderStageDue(t.due_date, todayBerlinISO())`; if `stageNow > t.reminder_stage`, `await sendPushToUser(t.assignee_user_id, { title, body, url: '/hr', tag: 'staffing-'+t.id })` then `markReminderStage(t.id, stageNow)`. Copy for overdue vs due-day vs lead differs by `stageNow`. Return `{ sent }`.

```ts
// src/app/api/cron/staffing-checklist-reminders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { listReminderCandidates, claimReminderStage } from '@/lib/staffing-checklist-db';
import { reminderStageDue } from '@/lib/staffing-logic';
import { berlinToday } from '@/lib/berlin-date';
import { getUserByEmployeeId } from '@/lib/db';
import { sendPushToUser } from '@/lib/push';

// Berlin hour (0–23) without pulling a date lib.
function berlinHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date()));
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'cron not configured' }, { status: 503 }); // fail closed
  if (new URL(req.url).searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const hour = berlinHour();
  if (hour < 9 || hour >= 21) return NextResponse.json({ ok: true, sent: 0, skipped: 'quiet-hours' });

  const today = berlinToday();
  let sent = 0;
  for (const t of listReminderCandidates()) {
    const stageNow = reminderStageDue(t.due_date, today);
    if (stageNow <= t.reminder_stage) continue;
    // Claim FIRST (at-most-once; safe against concurrent runs). A missing subscription
    // still counts as claimed, so we never retry it hourly.
    if (!claimReminderStage(t.id, stageNow)) continue;
    // Resolve the live portal user: stored user id, else the employee's current account.
    const userId = t.assignee_user_id ?? (t.assignee_employee_id != null ? getUserByEmployeeId(t.assignee_employee_id)?.id ?? null : null);
    if (userId == null) continue;
    const when = stageNow === 3 ? 'is overdue' : stageNow === 2 ? 'is due today' : 'is coming up';
    try {
      await sendPushToUser(userId, { title: 'Checklist task', body: `“${t.title}” ${when}.`, url: '/hr', tag: `staffing-${t.id}` });
      sent++;
    } catch (err: unknown) { console.error('[staffing] reminder push failed', err); }
  }
  return NextResponse.json({ ok: true, sent });
}
```

- [ ] **Step 3: Build.** Run `npm run build`. Expected: compiles.
- [ ] **Step 4: Verify idempotency** — create a task due today with reminder on and an assignee who has a push subscription; `curl "http://localhost:3000/api/cron/staffing-checklist-reminders?token=$CRON_SECRET"` → `sent:1`; run again → `sent:0`.
- [ ] **Step 5: Ops note** — add to the deploy doc the hourly crontab line: `0 * * * * curl -s "http://localhost:3000/api/cron/staffing-checklist-reminders?token=$CRON_SECRET"` (staging crontab, mirroring shift-confirm-reminders).
- [ ] **Step 6: Commit** `[ADD] hr: checklist reminder cron`.

---

# Phase 8 — Gating, attention badge, verification

### Task 15: Needs-attention badge + final gating + regression

**Files:**
- Modify: `src/app/api/hr/overview/route.ts` (add overdue-checklist count) and `src/components/hr/HrDashboard.tsx` (fold into `attentionCount`).

- [ ] **Step 1:** Add an overdue-open-checklist-tasks count to the HR overview payload (`SELECT COUNT(*) ... WHERE status='pending' AND due_date < today AND instance open`, company-scoped) and include it in the dashboard "Needs attention" badge.
- [ ] **Step 2:** Confirm gating end-to-end: template APIs reject non-admins (403); a staff user can tick only their own employee tasks; managers can tick business tasks; the Setup tile is hidden for non-admins.
- [ ] **Step 3: Build + lint.** Run `npm run build`. Expected: compiles clean.
- [ ] **Step 4: Full staging verification** (spec §12): create base+team+level lists for WAJ (co6); add employee → joining prompt merges base+team (9 tasks in the mock scenario); change level up → promotion; start termination → leaving; force due/overdue + run cron once (1 push) then again (0). Confirm on real devices per portal Playwright rule.
- [ ] **Step 5: Commit** `[IMP] hr: overdue checklist tasks feed Needs attention`.

---

## Self-Review

- **Spec coverage:** 3 stages (Tasks 3–4, 8–13) ✓; two sections/audience (types + merge + view) ✓; mix reminders (offset+reminder fields, cron) ✓; base+team add-on (merge in Task 2/4, Setup in 6) ✓; promotion by level (findLevelTemplate, Task 13) ✓; per-task responsible (resolveAssignee, Task 4) ✓; auto-with-confirm triggers (Tasks 10, 12, 13) ✓; portal-native SQLite (Task 3) ✓; push reminders via cron (Task 14) ✓; admin-only templates (Task 5) ✓; company-scoped (all APIs) ✓; journey timeline (Task 9) ✓; employee self-view (Task 11) ✓; needs-attention (Task 15) ✓; Odoo read-only fields (Task 7) ✓.
- **Placeholder scan:** UI tasks (6, 9, 11) describe structure + exact props/endpoints rather than every styled line — this follows the existing-codebase pattern rule; the novel logic (merge, resolution, dates, cron, snapshot) is fully coded and unit-tested. No "TBD"/"add error handling"/"write tests for the above".
- **Type consistency:** `startInstance`/`StartInstanceParams`, `setTaskStatus`, `getMyPendingEmployeeTasks`, `listReminderCandidates`, `reminderStageDue`, `dueState`, `mergeTaskSeeds`, `computeDueDate`, `todayBerlinISO` names are used identically across tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-staff-lifecycle-checklists.md`.
