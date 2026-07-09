# Shift Patterns + Publish-with-Deadline — Implementation Plan (Piece #1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager build a reusable weekly *pattern* of shifts, publish it into a chosen week as real `planning.slot` records with a staff-selection deadline, and have selection lock itself once the deadline passes — with a screen to build/publish patterns and see what's still uncovered.

**Architecture:** All portal-side. Shifts remain plain Odoo `planning.slot` (reuse `createSlot` + `publish` write). A pattern and its lines live in new SQLite tables; publishing generates slots for a week and records a *publish run* (with the deadline) plus the run→slot mapping. Lock is **lazy** (computed on read from `select_deadline`, then persisted) — no cron. Department + min-skill continue to use the existing `shift_slot_department` / `shift_slot_min_skill` overrides.

**Tech Stack:** Next.js 14 App Router (route handlers), TypeScript, better-sqlite3 (`@/lib/db` → `getDb()`), Odoo 18 JSON-RPC (`@/lib/odoo` → `getOdoo()`), Playwright (`*.unit.spec.ts` for pure logic; `*.e2e.spec.ts` on staging for flows).

## Global Constraints

- Single branch `main`; small commits; deploy = `git pull && npm run build && systemctl restart krawings-portal` on `root@89.167.124.0`. (Copied from `CLAUDE.md`.)
- `npm run build` must pass before any deploy (GitHub Action runs a build check). Never pipe `npm run build`.
- No Odoo model/field changes. Shifts are `planning.slot`; `department_id` + min-skill stay portal-side.
- TypeScript: catch blocks use `err: unknown` + `instanceof`; unused params prefixed `_`; JSX apostrophes as `’`; `Array.from()` not `[...set]`; `better-sqlite3` not `sqlite3`.
- Odoo datetimes are space-separated UTC-naive ("YYYY-MM-DD HH:MM:SS"); convert Berlin wall-clock via `berlinDateTimeToUtcOdoo`.
- Manager-only for every route in this piece: gate with `requireManagerCompany(...)` from `src/app/api/shifts/_manager.ts`.
- Mobile-first; reuse existing `AppHeader`, `WarnBox`, and shift UI primitives in `src/components/shifts/ui`. Desktop untouched unless asked.
- Playwright-test on staging (`portal.krawings.de`, manager `Marco Bauer`, company 6) before prod. **Snapshot real `planning.slot` rows before any test-data cleanup** (2026-07-08 data-loss lesson).

---

## File Structure

- `src/types/shifts.ts` — add `ShiftPatternLine`, `ShiftPattern`, `ShiftPublishRun`, `PublishRunState` types. (Modify)
- `src/lib/shifts-patterns.ts` — **pure** logic: `planSlotsForWeek(lines, weekKey)` and `effectivePublishState(state, selectDeadlineISO, nowISO)`. No I/O; unit-tested. (Create)
- `src/lib/shifts-db.ts` — add the four tables to `ensureTables()` and the CRUD helpers. (Modify)
- `src/app/api/shifts/patterns/route.ts` — GET list / POST create (with lines). (Create)
- `src/app/api/shifts/patterns/[id]/route.ts` — GET one / PUT replace / DELETE. (Create)
- `src/app/api/shifts/patterns/[id]/publish/route.ts` — POST generate + publish + record run. (Create)
- `src/app/api/shifts/runs/route.ts` — GET list runs (with effective lock state). (Create)
- `src/app/api/shifts/runs/[id]/route.ts` — GET one (with gaps) / POST transition (extend deadline / reopen / finalize). (Create)
- `src/components/shifts/PatternManager.tsx` — manager UI: list/build/edit patterns, publish with a deadline, view runs + uncovered count. (Create)
- `src/app/shifts/page.tsx` — add a `patterns` screen + entry point from the Planning gear. (Modify)
- `tests/shift-patterns.unit.spec.ts` — unit tests for the pure logic. (Create)
- `tests/shift-patterns.e2e.spec.ts` — staging flow: build → publish → verify slots + deadline + lock. (Create)

---

## Interfaces (locked signatures used across tasks)

```ts
// src/types/shifts.ts
export type PublishRunState = 'open' | 'locked' | 'finalized';
export interface ShiftPatternLine {
  weekday: number;          // 1=Mon … 7=Sun (ISO)
  startHHMM: string;        // "HH:MM"
  endHHMM: string;          // "HH:MM"
  roleId: number | null;
  departmentId: number | null;
  headcount: number;        // 1..20
  minSkill: '2' | '3' | null; // Associate+ / Team Lead / anyone(null)
}
export interface ShiftPattern {
  id: number; companyId: number; name: string; active: boolean;
  createdAt: string; lines: ShiftPatternLine[];
}
export interface ShiftPublishRun {
  id: number; companyId: number; patternId: number | null;
  weekKey: string; selectDeadline: string; // ISO
  state: PublishRunState; createdAt: string;
}

// src/lib/shifts-patterns.ts  (PURE)
export interface PlannedSlot {
  date: string;             // "YYYY-MM-DD" (Berlin)
  startHHMM: string; endHHMM: string;
  roleId: number | null; departmentId: number | null;
  minSkill: '2' | '3' | null;
}
export function planSlotsForWeek(lines: ShiftPatternLine[], weekKey: string): PlannedSlot[];
export function effectivePublishState(
  state: PublishRunState, selectDeadlineISO: string, nowISO: string,
): PublishRunState;

// src/lib/shifts-db.ts  (new helpers)
export function createPattern(v: { companyId: number; name: string; lines: ShiftPatternLine[] }): number;
export function listPatterns(companyId: number): ShiftPattern[];
export function getPattern(id: number, companyId: number): ShiftPattern | null;
export function replacePatternLines(id: number, companyId: number, name: string, lines: ShiftPatternLine[]): boolean;
export function deletePattern(id: number, companyId: number): boolean;
export function createPublishRun(v: { companyId: number; patternId: number | null; weekKey: string; selectDeadline: string }): number;
export function recordPublishSlots(runId: number, slotIds: number[]): void;
export function listPublishRuns(companyId: number): ShiftPublishRun[];
export function getPublishRun(id: number, companyId: number): ShiftPublishRun | null;
export function publishRunSlotIds(runId: number): number[];
export function setPublishRunState(id: number, companyId: number, state: PublishRunState): boolean;
export function setPublishRunDeadline(id: number, companyId: number, selectDeadline: string): boolean;
```

Reused (already exist): `createSlot({companyId,date,startHHMM,endHHMM,roleId,resourceId,note}): Promise<number>`, `getOdoo().write('planning.slot', ids, {state})`, `setSlotDepartments`, `setSlotMinSkills`, `recomputeWeekFlags`, `weekKeyDays`, `currentWeekKey`, `offsetWeekKey`, `requireManagerCompany`, `resolveWeekKey`, `normalizeHHMM`, `serverError`, `fetchWeekSlots`.

---

### Task 1: Types + pure planning/lock logic (TDD)

**Files:**
- Modify: `src/types/shifts.ts` (append the pattern/run types above)
- Create: `src/lib/shifts-patterns.ts`
- Test: `tests/shift-patterns.unit.spec.ts`

**Interfaces:** Produces `planSlotsForWeek`, `effectivePublishState`, `PlannedSlot` (signatures above).

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/shift-patterns.unit.spec.ts
import { test, expect } from '@playwright/test';
import { planSlotsForWeek, effectivePublishState } from '../src/lib/shifts-patterns';
import type { ShiftPatternLine } from '../src/types/shifts';

const line = (o: Partial<ShiftPatternLine>): ShiftPatternLine => ({
  weekday: 1, startHHMM: '09:00', endHHMM: '17:00',
  roleId: null, departmentId: null, headcount: 1, minSkill: null, ...o,
});

test('planSlotsForWeek expands headcount and maps weekday to the right Berlin date', () => {
  // 2026-W28 → Monday 2026-07-06 … Sunday 2026-07-12
  const out = planSlotsForWeek([line({ weekday: 5, headcount: 2, roleId: 7 })], '2026-W28');
  expect(out.length).toBe(2);
  expect(out[0].date).toBe('2026-07-10'); // Friday
  expect(out[0].roleId).toBe(7);
  expect(out[0].startHHMM).toBe('09:00');
});

test('planSlotsForWeek keeps per-line department and minSkill', () => {
  const out = planSlotsForWeek([line({ weekday: 1, departmentId: 3, minSkill: '3' })], '2026-W28');
  expect(out[0].date).toBe('2026-07-06'); // Monday
  expect(out[0].departmentId).toBe(3);
  expect(out[0].minSkill).toBe('3');
});

test('effectivePublishState locks an open run past its deadline', () => {
  expect(effectivePublishState('open', '2026-07-08T18:00:00.000Z', '2026-07-08T19:00:00.000Z')).toBe('locked');
  expect(effectivePublishState('open', '2026-07-08T20:00:00.000Z', '2026-07-08T19:00:00.000Z')).toBe('open');
});

test('effectivePublishState never overrides finalized', () => {
  expect(effectivePublishState('finalized', '2020-01-01T00:00:00.000Z', '2026-07-08T19:00:00.000Z')).toBe('finalized');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- shift-patterns`
Expected: FAIL (module `../src/lib/shifts-patterns` not found).

- [ ] **Step 3: Add the types to `src/types/shifts.ts`**

Append the `PublishRunState`, `ShiftPatternLine`, `ShiftPattern`, `ShiftPublishRun` interfaces exactly as in the Interfaces section above.

- [ ] **Step 4: Implement `src/lib/shifts-patterns.ts`**

```ts
/**
 * Shift patterns — PURE logic (no I/O), unit-tested.
 * planSlotsForWeek expands a weekly pattern into concrete dated slots for one
 * ISO week; effectivePublishState computes the lazy lock from the deadline.
 */
import { weekKeyDays } from '@/lib/shifts-time';
import type { PublishRunState, ShiftPatternLine } from '@/types/shifts';

export interface PlannedSlot {
  date: string;
  startHHMM: string;
  endHHMM: string;
  roleId: number | null;
  departmentId: number | null;
  minSkill: '2' | '3' | null;
}

/** Expand a pattern's lines into dated slots (one per headcount) for a week. */
export function planSlotsForWeek(lines: ShiftPatternLine[], weekKey: string): PlannedSlot[] {
  const days = weekKeyDays(weekKey); // [Mon..Sun] "YYYY-MM-DD"
  const out: PlannedSlot[] = [];
  for (const l of lines) {
    if (l.weekday < 1 || l.weekday > 7) continue;
    const date = days[l.weekday - 1];
    const n = Math.max(1, Math.min(20, l.headcount || 1));
    for (let i = 0; i < n; i++) {
      out.push({
        date,
        startHHMM: l.startHHMM,
        endHHMM: l.endHHMM,
        roleId: l.roleId,
        departmentId: l.departmentId,
        minSkill: l.minSkill,
      });
    }
  }
  return out;
}

/** Lazy lock: an 'open' run whose deadline has passed reads as 'locked'. */
export function effectivePublishState(
  state: PublishRunState,
  selectDeadlineISO: string,
  nowISO: string,
): PublishRunState {
  if (state !== 'open') return state;
  return Date.parse(nowISO) > Date.parse(selectDeadlineISO) ? 'locked' : 'open';
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm run test:unit -- shift-patterns`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/shifts.ts src/lib/shifts-patterns.ts tests/shift-patterns.unit.spec.ts
git commit -m "[ADD] shifts: pure pattern-expansion + lazy-lock logic (unit-tested)"
```

---

### Task 2: SQLite schema + CRUD helpers for patterns & runs

**Files:**
- Modify: `src/lib/shifts-db.ts` (tables in `ensureTables()`, new helpers)

**Interfaces:** Produces all `*Pattern*` / `*PublishRun*` DB helpers listed in Interfaces.

- [ ] **Step 1: Add the four tables inside the `ensureTables()` `db.exec(...)` block** (after `shift_slot_min_skill`)

```sql
CREATE TABLE IF NOT EXISTS shift_pattern (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pattern_company ON shift_pattern(company_id);

CREATE TABLE IF NOT EXISTS shift_pattern_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,
  start_hhmm TEXT NOT NULL,
  end_hhmm TEXT NOT NULL,
  role_id INTEGER,
  department_id INTEGER,
  headcount INTEGER NOT NULL DEFAULT 1,
  min_skill TEXT
);
CREATE INDEX IF NOT EXISTS idx_pattern_line_pattern ON shift_pattern_line(pattern_id);

CREATE TABLE IF NOT EXISTS shift_publish_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  pattern_id INTEGER,
  week_key TEXT NOT NULL,
  select_deadline TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_run_company ON shift_publish_run(company_id);

CREATE TABLE IF NOT EXISTS shift_publish_slot (
  run_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, slot_id)
);
```

- [ ] **Step 2: Add the CRUD helpers at the end of `shifts-db.ts`**

```ts
// -- Shift patterns (reusable weekly stencils) + publish runs -------------------

import type { ShiftPattern, ShiftPatternLine, ShiftPublishRun, PublishRunState } from '@/types/shifts';

interface PatternRow { id: number; company_id: number; name: string; active: number; created_at: string }
interface PatternLineRow {
  id: number; pattern_id: number; weekday: number; start_hhmm: string; end_hhmm: string;
  role_id: number | null; department_id: number | null; headcount: number; min_skill: string | null;
}

function mapLine(r: PatternLineRow): ShiftPatternLine {
  return {
    weekday: r.weekday, startHHMM: r.start_hhmm, endHHMM: r.end_hhmm,
    roleId: r.role_id, departmentId: r.department_id, headcount: r.headcount,
    minSkill: r.min_skill === '2' || r.min_skill === '3' ? r.min_skill : null,
  };
}

function insertLines(patternId: number, lines: ShiftPatternLine[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO shift_pattern_line (pattern_id, weekday, start_hhmm, end_hhmm, role_id, department_id, headcount, min_skill)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  for (const l of lines) {
    stmt.run(patternId, l.weekday, l.startHHMM, l.endHHMM, l.roleId, l.departmentId,
      Math.max(1, Math.min(20, l.headcount || 1)), l.minSkill);
  }
}

export function createPattern(v: { companyId: number; name: string; lines: ShiftPatternLine[] }): number {
  ensureTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO shift_pattern (company_id, name, active, created_at) VALUES (?,?,1,?)',
    ).run(v.companyId, v.name, nowISO());
    const id = Number(info.lastInsertRowid);
    insertLines(id, v.lines);
    return id;
  });
  return tx();
}

export function listPatterns(companyId: number): ShiftPattern[] {
  ensureTables();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM shift_pattern WHERE company_id=? AND active=1 ORDER BY id DESC')
    .all(companyId) as PatternRow[];
  return rows.map(r => ({
    id: r.id, companyId: r.company_id, name: r.name, active: r.active === 1, createdAt: r.created_at,
    lines: (db.prepare('SELECT * FROM shift_pattern_line WHERE pattern_id=? ORDER BY weekday, start_hhmm')
      .all(r.id) as PatternLineRow[]).map(mapLine),
  }));
}

export function getPattern(id: number, companyId: number): ShiftPattern | null {
  ensureTables();
  const db = getDb();
  const r = db.prepare('SELECT * FROM shift_pattern WHERE id=? AND company_id=?').get(id, companyId) as PatternRow | undefined;
  if (!r) return null;
  const lines = (db.prepare('SELECT * FROM shift_pattern_line WHERE pattern_id=? ORDER BY weekday, start_hhmm')
    .all(id) as PatternLineRow[]).map(mapLine);
  return { id: r.id, companyId: r.company_id, name: r.name, active: r.active === 1, createdAt: r.created_at, lines };
}

export function replacePatternLines(id: number, companyId: number, name: string, lines: ShiftPatternLine[]): boolean {
  ensureTables();
  const db = getDb();
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE shift_pattern SET name=? WHERE id=? AND company_id=?').run(name, id, companyId);
    if (upd.changes !== 1) return false;
    db.prepare('DELETE FROM shift_pattern_line WHERE pattern_id=?').run(id);
    insertLines(id, lines);
    return true;
  });
  return tx();
}

export function deletePattern(id: number, companyId: number): boolean {
  ensureTables();
  const db = getDb();
  const info = db.prepare('UPDATE shift_pattern SET active=0 WHERE id=? AND company_id=?').run(id, companyId);
  return info.changes === 1;
}

interface RunRow { id: number; company_id: number; pattern_id: number | null; week_key: string; select_deadline: string; state: string; created_at: string }
function mapRun(r: RunRow): ShiftPublishRun {
  const st = (['open', 'locked', 'finalized'] as const).includes(r.state as PublishRunState) ? (r.state as PublishRunState) : 'open';
  return { id: r.id, companyId: r.company_id, patternId: r.pattern_id, weekKey: r.week_key, selectDeadline: r.select_deadline, state: st, createdAt: r.created_at };
}

export function createPublishRun(v: { companyId: number; patternId: number | null; weekKey: string; selectDeadline: string }): number {
  ensureTables();
  const info = getDb().prepare(
    'INSERT INTO shift_publish_run (company_id, pattern_id, week_key, select_deadline, state, created_at) VALUES (?,?,?,?,\'open\',?)',
  ).run(v.companyId, v.patternId, v.weekKey, v.selectDeadline, nowISO());
  return Number(info.lastInsertRowid);
}

export function recordPublishSlots(runId: number, slotIds: number[]): void {
  if (slotIds.length === 0) return;
  ensureTables();
  const stmt = getDb().prepare('INSERT OR IGNORE INTO shift_publish_slot (run_id, slot_id) VALUES (?,?)');
  const tx = getDb().transaction((ids: number[]) => { for (const s of ids) stmt.run(runId, s); });
  tx(slotIds);
}

export function listPublishRuns(companyId: number): ShiftPublishRun[] {
  ensureTables();
  return (getDb().prepare('SELECT * FROM shift_publish_run WHERE company_id=? ORDER BY id DESC').all(companyId) as RunRow[]).map(mapRun);
}

export function getPublishRun(id: number, companyId: number): ShiftPublishRun | null {
  ensureTables();
  const r = getDb().prepare('SELECT * FROM shift_publish_run WHERE id=? AND company_id=?').get(id, companyId) as RunRow | undefined;
  return r ? mapRun(r) : null;
}

export function publishRunSlotIds(runId: number): number[] {
  ensureTables();
  return (getDb().prepare('SELECT slot_id FROM shift_publish_slot WHERE run_id=?').all(runId) as { slot_id: number }[]).map(x => x.slot_id);
}

export function setPublishRunState(id: number, companyId: number, state: PublishRunState): boolean {
  ensureTables();
  return getDb().prepare('UPDATE shift_publish_run SET state=? WHERE id=? AND company_id=?').run(state, id, companyId).changes === 1;
}

export function setPublishRunDeadline(id: number, companyId: number, selectDeadline: string): boolean {
  ensureTables();
  return getDb().prepare('UPDATE shift_publish_run SET select_deadline=? WHERE id=? AND company_id=?').run(selectDeadline, id, companyId).changes === 1;
}
```

- [ ] **Step 2b:** Move the new `import type { ... }` to the existing type-import block at the top of the file (don't leave a mid-file import); confirm `ShiftPattern`/`ShiftPatternLine`/`ShiftPublishRun`/`PublishRunState` are exported from `@/types/shifts`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/shifts-db.ts
git commit -m "[ADD] shifts: SQLite tables + CRUD for patterns and publish runs"
```

---

### Task 3: Patterns CRUD endpoints

**Files:**
- Create: `src/app/api/shifts/patterns/route.ts`, `src/app/api/shifts/patterns/[id]/route.ts`

**Interfaces:** Consumes Task 2 helpers + `_manager` helpers. Produces `GET/POST /api/shifts/patterns`, `GET/PUT/DELETE /api/shifts/patterns/[id]`.

- [ ] **Step 1: Implement `patterns/route.ts`** — GET → `{ patterns: listPatterns(companyId) }`; POST validates `name` (1..40) and a `lines[]` array where each line has a valid `weekday` (1..7), `normalizeHHMM(start/end)` (start≠end), `role_id?` (number>0|null), `department_id?` (number>0|null), `headcount` (1..20, default 1), `min_skill` ('2'|'3'|null). Reject if `lines` is empty. Return `{ ok:true, id }`. Follow the exact validation idiom in `slots/route.ts` and `templates/route.ts`.

- [ ] **Step 2: Implement `patterns/[id]/route.ts`** — GET → `getPattern` (404 if null); PUT → `replacePatternLines` (same line validation; 404 if it returns false); DELETE → `deletePattern` (404 if false). All gated with `requireManagerCompany`.

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/shifts/patterns
git commit -m "[ADD] shifts: pattern CRUD API (list/create/get/update/delete)"
```

---

### Task 4: Publish endpoint (generate slots + deadline + run)

**Files:**
- Create: `src/app/api/shifts/patterns/[id]/publish/route.ts`

**Interfaces:** Consumes `getPattern`, `planSlotsForWeek`, `createSlot`, `getOdoo().write`, `setSlotDepartments`, `setSlotMinSkills`, `recomputeWeekFlags`, `createPublishRun`, `recordPublishSlots`, `resolveWeekKey`. Produces `POST /api/shifts/patterns/[id]/publish`.

- [ ] **Step 1: Implement the route**

Body: `{ company_id, week, select_deadline }`. Steps:
1. `requireManagerCompany`; `getPattern(id, companyId)` (404 if null).
2. `weekKey = resolveWeekKey(week)` (400 if null).
3. Validate `select_deadline` is a parseable ISO string in the future (400 otherwise).
4. `const planned = planSlotsForWeek(pattern.lines, weekKey)`; if empty → 400 "This pattern has no shifts".
5. For each planned slot: `const slotId = await createSlot({ companyId, date, startHHMM, endHHMM, roleId, resourceId: null, note: '' })`; collect ids, and remember its `departmentId` / `minSkill` for the batch overrides. Group ids by departmentId → `setSlotDepartments`; group by minSkill → `setSlotMinSkills`.
6. `await getOdoo().write('planning.slot', allIds, { state: 'published' })`.
7. `const runId = createPublishRun({ companyId, patternId: pattern.id, weekKey, selectDeadline })`; `recordPublishSlots(runId, allIds)`.
8. `await recomputeWeekFlags(companyId, weekKey, [])` (refresh open-shift/over-cap flags for the week).
9. Return `{ ok: true, runId, created: allIds.length }`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/shifts/patterns
git commit -m "[ADD] shifts: publish a pattern into a week with a selection deadline"
```

---

### Task 5: Runs endpoints (list, gaps, transition, lazy-lock)

**Files:**
- Create: `src/app/api/shifts/runs/route.ts`, `src/app/api/shifts/runs/[id]/route.ts`

**Interfaces:** Consumes `listPublishRuns`, `getPublishRun`, `publishRunSlotIds`, `setPublishRunState`, `setPublishRunDeadline`, `effectivePublishState`, `fetchWeekSlots`. Produces `GET /api/shifts/runs`, `GET/POST /api/shifts/runs/[id]`.

- [ ] **Step 1: Implement `runs/route.ts`** — GET: list runs; for each, compute `state = effectivePublishState(run.state, run.selectDeadline, new Date().toISOString())`; **persist** the flip (`if (state !== run.state && state === 'locked') setPublishRunState(run.id, companyId, 'locked')`); return runs with the effective `state`.

- [ ] **Step 2: Implement `runs/[id]/route.ts`**
  - GET: return the run (effective state, persisted like above) plus **gaps**: read `publishRunSlotIds(runId)`, load the week's slots via `fetchWeekSlots(companyId, run.weekKey)`, and count those run-slots that are still unassigned (`employeeId === null`) → `{ run, gaps: { open, total } }`.
  - POST (transition): body `{ company_id, action, select_deadline? }`.
    - `action==='extend'` → validate future ISO, `setPublishRunDeadline` + `setPublishRunState(id,companyId,'open')` (reopen if it had auto-locked). 
    - `action==='reopen'` → `setPublishRunState(id,companyId,'open')` **and** bump the deadline if it is in the past (require `select_deadline`).
    - `action==='finalize'` → `setPublishRunState(id,companyId,'finalized')`.
    - Reject unknown actions (400). **Transitions never delete slots or picks.**

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/shifts/runs
git commit -m "[ADD] shifts: publish-run list/gaps/transition with lazy deadline lock"
```

---

### Task 6: Manager UI — PatternManager screen

**Files:**
- Create: `src/components/shifts/PatternManager.tsx`
- Modify: `src/app/shifts/page.tsx` (add `patterns` screen + gear entry)

**Interfaces:** Consumes the pattern + run endpoints. Produces a `patterns` screen reachable from the Planning gear.

**Contract (build against these acceptance criteria; reuse `AppHeader`, `WarnBox`, and `src/components/shifts/ui` primitives; mobile-first tokens per `DESIGN_GUIDE.md`):**
- Lists existing patterns (name + a "3 shifts / week" summary); "New pattern" primary button.
- Pattern editor: add/remove lines, each line = weekday picker (Mon–Sun), start/end time, role (company-scoped select), department, headcount stepper (1–20), min-skill select (Anyone / Associate+ / Team Lead). Save → POST/PUT.
- "Publish" action on a pattern: pick a target week (default `currentWeekKey()`, with next-week via `offsetWeekKey(currentWeekKey(),1)`), pick a "choose by" deadline (date+time), confirm → POST publish; on success show "Published N shifts — staff can choose until <deadline>".
- Runs list: each run shows week, deadline, live state (Open / Locked / Finalized via the effective state from the API) and the uncovered count ("3 of 12 still open"); actions Extend / Reopen / Finalize call the transition endpoint.
- All copy plain-English; no ERP jargon; company-scoped to the header switcher company.

- [ ] **Step 1:** Build `PatternManager.tsx` to the contract above (state via `useState`/`useEffect`, `fetch` the endpoints, optimistic-free; show `Spinner` while loading, `WarnBox` for errors). Follow the structure of an existing manager component (e.g. `ShiftSettings.tsx` / `RolesDeptManager.tsx`).
- [ ] **Step 2:** In `src/app/shifts/page.tsx`, add a `patterns` screen type to the navigation and a gear/menu entry ("Patterns & publishing"); wire back-navigation via the existing `PARENT`/`goBack` map.
- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/shifts/PatternManager.tsx src/app/shifts/page.tsx
git commit -m "[ADD] shifts: Patterns & publishing manager screen"
```

---

### Task 7: Deploy + Playwright e2e on staging

**Files:**
- Create: `tests/shift-patterns.e2e.spec.ts`

- [ ] **Step 1: Deploy to staging**

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'
```

- [ ] **Step 2: Write the e2e** (mirror `tests/kiosk-settings.e2e.spec.ts` structure: `SMOKE_ENV=staging`, manager auth via `auth.setup.ts`, company 6). Flow: open Planning → gear → Patterns → create a pattern with 1 line (tag name `E2E Pattern <ts>`) → publish into next week with a deadline 1h out → assert "Published" and the run shows an open count. Use unique tagged names for cleanup.

- [ ] **Step 3: Run it**

Run: `npm run test:staging -- shift-patterns` (or `SMOKE_ENV=staging npx playwright test shift-patterns.e2e --project=modules`)
Expected: PASS.

- [ ] **Step 4:** Manually verify in a real browser on `portal.krawings.de` (manager) that the published shifts appear in Manage and that after the deadline the run reads "Locked". **Snapshot co6 `planning.slot` before cleaning up any test shifts**, then remove only the tagged test data.

- [ ] **Step 5: Commit**

```bash
git add tests/shift-patterns.e2e.spec.ts
git commit -m "[ADD] shifts: e2e for pattern build + publish + deadline"
```

---

## Self-Review

- **Spec coverage (Part B1 of the spec):** patterns ✔ (T1,T2,T3), publish+deadline ✔ (T4), lazy lock ✔ (T1 pure + T5 persist), gaps/gap-fill surface ✔ (T5 gaps + T6 runs list), reversibility extend/reopen/finalize ✔ (T5), department+min-skill reuse ✔ (T4 uses existing overrides), recurring daily-opening = a 1-line pattern ✔ (T6). No Odoo change ✔.
- **Deferred to later pieces (intentionally, not gaps here):** weekend quota, hour warnings, forecast — Pieces #2–#4, separate plans.
- **Placeholder scan:** pure-logic + DB + publish steps carry full code; endpoint/UI tasks carry exact file paths, consumed signatures, and acceptance criteria (this codebase builds UI against Playwright/staging, not pre-written JSX). No TODO/TBD.
- **Type consistency:** `PlannedSlot`, `ShiftPatternLine`, `PublishRunState`, and every helper name match between the Interfaces block, Task 1, and Task 2.
