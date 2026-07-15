# Shift-Confirmation Nudges + Manager Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Chase the existing silent "I'll be there" confirmation with automatic reminders + a manager "not yet confirmed" board, so no-shows are caught before service.

**Architecture:** Reuse `shift_confirmations` as truth for "confirmed". A pure reminder-stage function decides which nudge is due; a token-authed hourly cron drives staff pushes + a manager overdue alert. A per-company toggle gates it. Manager board reads unconfirmed assigned shifts and offers nudge / release / mark-confirmed. No auto-release.

**Tech Stack:** Next.js 14 App Router (route handlers + client components), TypeScript, better-sqlite3 (`@/lib/db` → `getDb()`), Odoo JSON-RPC (`@/lib/odoo`), Vitest for unit tests, VAPID web-push (`@/lib/shifts-notify`).

## Global Constraints
- `planning.slot` is the source of truth for shifts; portal SQLite (`shifts-db.ts`) holds workflow state.
- Company-scoped + role-gated (staff < manager < admin). Feature **off by default** per company.
- Berlin time via `@/lib/shifts-time`; Odoo datetimes are space-separated UTC.
- Single branch `main`; deploy = push → `ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'`. Never `git add -A`.
- Only touch company 6 (What a Jerk) for testing; clean up test data.
- Reminder blast guard: `first` nudge only for shifts starting within 7 days.

---

### Task 1: Pure reminder-stage logic + unit tests

**Files:**
- Create: `src/lib/shift-confirm.ts`
- Test: `tests/shift-confirm.unit.spec.ts`

**Interfaces:**
- Produces:
  - `type ReminderStage = 'first' | 'reminder' | 'overdue_mgr'`
  - `const FIRST_LEAD_MS`, `const REMINDER_LEAD_MS` (numbers)
  - `confirmByMs(startMs: number, confirmByHours: number): number`
  - `nextReminderStage(i: { startMs: number; nowMs: number; confirmByHours: number; sentStages: ReminderStage[]; confirmed: boolean }): ReminderStage | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shift-confirm.unit.spec.ts
import { describe, it, expect } from 'vitest';
import { nextReminderStage, confirmByMs, FIRST_LEAD_MS, REMINDER_LEAD_MS } from '../src/lib/shift-confirm';

const H = 3600e3;
const base = { confirmByHours: 24, sentStages: [] as any[], confirmed: false };
// start 3 days out, nothing sent -> 'first' (within 7-day window)
const start = 3 * 24 * H;

describe('nextReminderStage', () => {
  it('confirmed -> null', () => {
    expect(nextReminderStage({ ...base, startMs: start, nowMs: 0, confirmed: true })).toBeNull();
  });
  it('unconfirmed, >7 days out, nothing sent -> null (no burst)', () => {
    const far = 10 * 24 * H;
    expect(nextReminderStage({ ...base, startMs: far, nowMs: 0 })).toBeNull();
  });
  it('unconfirmed, within 7 days, nothing sent -> first', () => {
    expect(nextReminderStage({ ...base, startMs: start, nowMs: 0 })).toBe('first');
  });
  it('first already sent, not near cutoff -> null', () => {
    expect(nextReminderStage({ ...base, startMs: start, nowMs: 0, sentStages: ['first'] })).toBeNull();
  });
  it('first sent, within REMINDER_LEAD of cutoff -> reminder', () => {
    const now = confirmByMs(start, 24) - REMINDER_LEAD_MS + 1;
    expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['first'] })).toBe('reminder');
  });
  it('past cutoff, overdue not sent -> overdue_mgr', () => {
    const now = confirmByMs(start, 24) + 1;
    expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['first', 'reminder'] })).toBe('overdue_mgr');
  });
  it('past cutoff, overdue already sent -> null', () => {
    const now = confirmByMs(start, 24) + 1;
    expect(nextReminderStage({ ...base, startMs: start, nowMs: now, sentStages: ['overdue_mgr'] })).toBeNull();
  });
  it('shift already started -> null', () => {
    expect(nextReminderStage({ ...base, startMs: start, nowMs: start + 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`npx vitest run tests/shift-confirm.unit.spec.ts` → module not found)

- [ ] **Step 3: Implement**

```ts
// src/lib/shift-confirm.ts
/** Pure reminder-stage decision for shift confirmation (no I/O; unit-tested). */
export type ReminderStage = 'first' | 'reminder' | 'overdue_mgr';

/** Only begin 'first' nudges once a shift is within this window (avoids a burst when first enabled). */
export const FIRST_LEAD_MS = 7 * 24 * 3600e3;
/** 'reminder' fires once we are within this long of the confirm-by cutoff. */
export const REMINDER_LEAD_MS = 6 * 3600e3;

export function confirmByMs(startMs: number, confirmByHours: number): number {
  return startMs - confirmByHours * 3600e3;
}

export function nextReminderStage(i: {
  startMs: number; nowMs: number; confirmByHours: number;
  sentStages: ReminderStage[]; confirmed: boolean;
}): ReminderStage | null {
  if (i.confirmed) return null;
  if (i.nowMs >= i.startMs) return null; // shift started — too late to chase
  const sent = (s: ReminderStage) => i.sentStages.includes(s);
  const cutoff = confirmByMs(i.startMs, i.confirmByHours);
  if (i.nowMs >= cutoff) return sent('overdue_mgr') ? null : 'overdue_mgr';
  if (!sent('first')) return i.startMs - i.nowMs <= FIRST_LEAD_MS ? 'first' : null;
  if (!sent('reminder') && cutoff - i.nowMs <= REMINDER_LEAD_MS) return 'reminder';
  return null;
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit** `git add src/lib/shift-confirm.ts tests/shift-confirm.unit.spec.ts && git commit -m "[ADD] shifts: pure reminder-stage logic for confirmations"`

---

### Task 2: DB — settings columns, reminders table, helpers

**Files:**
- Modify: `src/lib/shifts-db.ts` (settings `CREATE TABLE` block, the ALTER-migration block, and add helpers near `confirmSlot`/`confirmedSlotIds` ~L338-355)

**Interfaces:**
- Produces: `reminderStagesSent(slotId: number): ReminderStage[]`, `markReminderSent(slotId: number, stage: ReminderStage): void`, `clearConfirmReminders(slotId: number): void`, `clearConfirmation(slotId: number): void`; and settings get/set include `requireConfirmation: boolean`, `confirmByHours: number`.

- [ ] **Step 1: Add columns + table (in `initTables`).** In the ALTER block that already `try/catch`es "duplicate column", add:
```ts
for (const [col, def] of [['require_confirmation', 'INTEGER NOT NULL DEFAULT 0'], ['confirm_by_hours', 'REAL NOT NULL DEFAULT 24']] as const) {
  try { db.exec(`ALTER TABLE shift_settings ADD COLUMN ${col} ${def}`); }
  catch (e) { if (!String((e as Error)?.message).includes('duplicate column')) throw e; }
}
db.exec(`CREATE TABLE IF NOT EXISTS shift_confirm_reminders (
  slot_id INTEGER NOT NULL, stage TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (slot_id, stage)
);`);
```
(Match the file's existing ALTER pattern — if it uses inline `initTables` SQL rather than a loop, add two `ALTER` lines in that style + the CREATE.)

- [ ] **Step 2: Add helpers** (near `confirmedSlotIds`):
```ts
import type { ReminderStage } from '@/lib/shift-confirm';

export function reminderStagesSent(slotId: number): ReminderStage[] {
  return (getDb().prepare('SELECT stage FROM shift_confirm_reminders WHERE slot_id=?').all(slotId) as { stage: string }[])
    .map(r => r.stage as ReminderStage);
}
export function markReminderSent(slotId: number, stage: ReminderStage): void {
  getDb().prepare('INSERT OR IGNORE INTO shift_confirm_reminders (slot_id, stage, sent_at) VALUES (?,?,?)').run(slotId, stage, nowISO());
}
export function clearConfirmReminders(slotId: number): void {
  getDb().prepare('DELETE FROM shift_confirm_reminders WHERE slot_id=?').run(slotId);
}
export function clearConfirmation(slotId: number): void {
  getDb().prepare('DELETE FROM shift_confirmations WHERE slot_id=?').run(slotId);
}
```

- [ ] **Step 3: Extend settings get/set.** Find the settings reader/writer (used by `/api/shifts/settings`). Add `require_confirmation`→`requireConfirmation` (0/1↔bool) and `confirm_by_hours`→`confirmByHours` to the SELECT, the returned object, and the UPDATE column list. Keep existing fields.

- [ ] **Step 4: Verify build** `npx tsc --noEmit` (ignore stale `.next/types` TS6053).
- [ ] **Step 5: Commit** `git add src/lib/shifts-db.ts && git commit -m "[ADD] shifts: confirmation settings + reminder-tracking schema/helpers"`

---

### Task 3: Settings API + UI (toggle + cutoff)

**Files:**
- Modify: `src/app/api/shifts/settings/route.ts` (GET returns the two new fields; PUT accepts `requireConfirmation?`, `confirmByHours?`)
- Modify: `src/components/shifts/ShiftSettings.tsx` (add a "Require shift confirmation" toggle + a "Confirm by (hours before shift)" number, saved via the existing PUT)

**Interfaces:** Consumes settings get/set from Task 2.

- [ ] **Step 1:** GET: include `requireConfirmation`, `confirmByHours` in the response object. PUT: read them from the body (validate `confirmByHours` is a finite number 1–168; coerce toggle to 0/1) and pass to the setter. Follow the existing field handling in the route.
- [ ] **Step 2:** ShiftSettings.tsx: add a toggle row + number input bound to the settings state, matching the existing settings controls; on save they go in the same PUT body. Wrap the cutoff input so it only shows when the toggle is on.
- [ ] **Step 3:** `npx tsc --noEmit` + `npx eslint` the two files.
- [ ] **Step 4: Commit** `git add src/app/api/shifts/settings/route.ts src/components/shifts/ShiftSettings.tsx && git commit -m "[ADD] shifts: require-confirmation setting + confirm-by cutoff in Shift settings"`

---

### Task 4: Confirm route (manager on-behalf) + nudge route

**Files:**
- Modify: `src/app/api/shifts/confirm/route.ts` (accept optional `employee_id` for manager on-behalf confirm)
- Create: `src/app/api/shifts/confirm/nudge/route.ts` (manager sends a push for one slot)

**Interfaces:** Consumes `confirmSlot`, `fetchSlot` (shifts-odoo), `notifyEmployee`, `getUserByEmployeeId`.

- [ ] **Step 1: confirm route on-behalf.** After the existing self-confirm checks, allow: if `body.employee_id` is present AND the caller is a manager for `companyId` (use `requireManagerCompany` from `_manager.ts`), confirm for that employee provided `slot.employeeId === body.employee_id`. Audit-log the on-behalf confirm. Staff self-path (`slot.employeeId === user.employee_id`) unchanged.
- [ ] **Step 2: nudge route** (`POST /api/shifts/confirm/nudge` { company_id, slot_id }): manager-gated (`requireManagerCompany`); load the slot; resolve the assignee's portal user via `getUserByEmployeeId(slot.employeeId)`; `await notifyEmployee(userId, ..., 'confirm_reminder', { slotId, ... })`; return `{ ok: true }`. 404 if slot not assigned / not found.
- [ ] **Step 3:** `npx tsc --noEmit` + eslint.
- [ ] **Step 4: Commit** `git add src/app/api/shifts/confirm/ && git commit -m "[ADD] shifts: manager on-behalf confirm + manual nudge route"`

---

### Task 5: Unconfirmed board API

**Files:**
- Create: `src/app/api/shifts/unconfirmed/route.ts`

**Interfaces:** Consumes `requireManagerCompany`, `fetchWeekSlots`/an assigned-future-slots fetch (shifts-odoo), `confirmedSlotIds`, `reminderStagesSent`, settings getter, `confirmByMs` (shift-confirm), `berlinParts`/`nowOdooUtc` (shifts-time).

- [ ] **Step 1:** `GET /api/shifts/unconfirmed?company_id=` (manager): gather **assigned (resource_id set) + published + future** slots for the company (reuse the assigned-slots read used by `overview`/`coverage`; filter `start > now`). Drop any in `confirmedSlotIds(companyId)`. For each remaining: compute `confirmBy = confirmByMs(startMs, settings.confirmByHours)`, `remindersSent = reminderStagesSent(slot.id).length`, `overdue = now >= confirmBy`. Return `{ enabled: settings.requireConfirmation, shifts: [{ slotId, employeeId, employeeName, start, end, roleName, departmentName, confirmBy, remindersSent, overdue }], overdueCount }` sorted by start asc.
- [ ] **Step 2:** `npx tsc --noEmit` + eslint. Live smoke: 200 for a manager token, 403 for staff.
- [ ] **Step 3: Commit** `git add src/app/api/shifts/unconfirmed/route.ts && git commit -m "[ADD] shifts: unconfirmed-shifts board API"`

---

### Task 6: Reminder cron

**Files:**
- Create: `src/app/api/cron/shift-confirm-reminders/route.ts`
- Modify: `src/lib/shifts-notify.ts` (add `PUSH_TITLES` entries: `confirm_reminder`, `confirm_overdue_mgr`)

**Interfaces:** Consumes `nextReminderStage`, `markReminderSent`, `reminderStagesSent`, `confirmedSlotIds`, settings, assigned-future-slots read, `notifyEmployee`, `notifyManagers`, `getUserByEmployeeId`. Mirror `cron/prep-forecast/route.ts` for token auth + `?companies=` parsing.

- [ ] **Step 1: Add push titles** in `shifts-notify.ts` `PUSH_TITLES`: `confirm_reminder: 'Confirm your shift'`, `confirm_overdue_mgr: 'Shift not confirmed'`.
- [ ] **Step 2: Cron handler.** `GET /api/cron/shift-confirm-reminders?token=<CRON_SECRET>&companies=6`:
  - Validate token exactly like `prep-forecast`.
  - Companies = `?companies` list, else all companies with `require_confirmation=1`.
  - For each company with the feature on: fetch assigned+published+future slots; `confirmed = confirmedSlotIds(companyId)`; `nowMs = Date.now()` **(allowed here — a route handler, not a workflow script)**.
  - For each slot not confirmed: `stage = nextReminderStage({ startMs, nowMs, confirmByHours: settings.confirmByHours, sentStages: reminderStagesSent(slotId), confirmed: false })`.
    - `null` → skip.
    - `first`/`reminder` → resolve `getUserByEmployeeId(slot.employeeId)`; if a user, `await notifyEmployee(user.id, 'confirm_reminder', { slotId, start })`; `markReminderSent(slotId, stage)`.
    - `overdue_mgr` → `await notifyManagers(companyId, 'confirm_overdue_mgr', { slotId, employeeName, start })`; `markReminderSent(slotId, 'overdue_mgr')`.
  - Return `{ ok: true, companies: n, sent: { first, reminder, overdue_mgr } }`.
- [ ] **Step 3:** `npx tsc --noEmit` + eslint.
- [ ] **Step 4: Commit** `git add src/app/api/cron/shift-confirm-reminders/ src/lib/shifts-notify.ts && git commit -m "[ADD] shifts: confirmation-reminder cron"`

---

### Task 7: Staff confirm UI

**Files:**
- Modify: `src/components/shifts/MyShifts.tsx`

**Interfaces:** Consumes `POST /api/shifts/confirm` and whatever "my shifts" fetch already exists; needs the feature flag + confirmed set (extend that fetch or the summary API to return `requireConfirmation` + `confirmed` per slot).

- [ ] **Step 1:** When `requireConfirmation` is on for the company, each of the viewer's **assigned, published, future** shifts shows either a green ✓ "Confirmed" chip or a primary **"Confirm you'll be there"** button. Tapping POSTs `{ company_id, slot_id }` to `/api/shifts/confirm`, then optimistically marks it confirmed. Match MyShifts' existing card + button styling.
- [ ] **Step 2:** Ensure the data source exposes per-shift confirmed state + the feature flag (extend the MyShifts fetch/route minimally; reuse `confirmedSlotIds`).
- [ ] **Step 3:** `npx tsc --noEmit` + eslint. Browser smoke later in Task 10.
- [ ] **Step 4: Commit** `git add src/components/shifts/MyShifts.tsx <any route touched> && git commit -m "[ADD] shifts: staff confirm button on My Shifts"`

---

### Task 8: Manager "Not yet confirmed" board UI

**Files:**
- Create: `src/components/shifts/UnconfirmedBoard.tsx`
- Modify: `src/app/shifts/page.tsx` (add `unconfirmed` screen + navigation), `src/components/shifts/ShiftsDashboard.tsx` (manager tile with count badge)

**Interfaces:** Consumes `GET /api/shifts/unconfirmed`, `POST /api/shifts/confirm/nudge`, `POST /api/shifts/confirm` (on-behalf), and the existing release/unassign call on `slots/[id]`.

- [ ] **Step 1:** `UnconfirmedBoard` lists rows from the API (employee, day+time, role, "X reminders", confirm-by). Overdue rows use the red/amber danger style. Each row: **Nudge** (POST nudge → toast), **Release** (confirm dialog → the existing unassign mutation → refresh), **Mark confirmed** (POST confirm on-behalf → row turns confirmed). Empty state "Everyone's confirmed 🎉". Follow `ManagerOverview.tsx`/`OpenShiftsList.tsx` patterns (AppHeader, cards).
- [ ] **Step 2:** Wire a `unconfirmed` screen in `page.tsx` (PARENT → dashboard) and a manager-only dashboard tile "Not yet confirmed" with the `overdueCount`/count badge, shown only when the feature is enabled.
- [ ] **Step 3:** `npx tsc --noEmit` + eslint.
- [ ] **Step 4: Commit** `git add src/components/shifts/UnconfirmedBoard.tsx src/app/shifts/page.tsx src/components/shifts/ShiftsDashboard.tsx && git commit -m "[ADD] shifts: manager not-yet-confirmed board"`

---

### Task 9: Clear confirmation on unassign + finalize

**Files:**
- Modify: `src/app/api/shifts/slots/[id]/route.ts` (and any cover/approval path that reassigns) to call `clearConfirmation(slotId)` + `clearConfirmReminders(slotId)` when a slot's assignee is removed/changed.

- [ ] **Step 1:** In the unassign/reassign branch(es), after the Odoo write, call `clearConfirmation(slotId)` + `clearConfirmReminders(slotId)` so a new assignee starts fresh (and a released shift doesn't keep a stale confirmed/overdue state). Grep for `updateSlot(...resource_id`/give-away/cover accept to cover each reassignment site.
- [ ] **Step 2:** `npx tsc --noEmit` + eslint.
- [ ] **Step 3: Commit** `git add -p` the touched files & commit `"[ADD] shifts: reset confirmation state when a shift is reassigned"`.

---

### Task 10: Deploy + end-to-end verification

- [ ] **Step 1:** Push; deploy to staging (`git pull --ff-only && npm run build && systemctl restart`). Confirm the running build post-dates the commit (concurrent-deploy gotcha).
- [ ] **Step 2:** Add the crontab line on staging: `0 * * * * curl -s "http://localhost:3000/api/cron/shift-confirm-reminders?token=$CRON_SECRET"` (verify `CRON_SECRET` is set; mirror the prep-forecast crontab entry).
- [ ] **Step 3:** Enable for co6 via settings PUT. Assign+publish a near-future shift to a schedulable staffer. Manually hit the cron endpoint; assert the staff push/notification + a board row; test **nudge**, **mark confirmed**, and **release** (returns to open pool). Force one past the cutoff (small `confirm_by_hours`) and re-run the cron → assert the manager `overdue_mgr` alert fires once + the row is overdue.
- [ ] **Step 4:** Playwright: staff My Shifts shows the confirm button → confirmed check; manager board renders with actions.
- [ ] **Step 5:** Clean up all test data (confirmations, reminders, the test slot's assignment). Turn the feature back off for co6 unless the owner wants it on.
- [ ] **Step 6:** Update memory + Obsidian log.

---

## Self-Review
- **Spec coverage:** settings toggle+cutoff (T3), staff confirm UI (T7), reminder cadence/cron (T1+T6), manager board + actions (T5+T8), overdue manager alert (T6), no-auto-release (design — board release is manual, T8), no-burst guard (T1 `FIRST_LEAD_MS`), clear-on-reassign (T9), deploy+cron+verify (T10). ✓
- **Placeholders:** none — pure logic + schema + API contracts are concrete; UI tasks specify exact files, data, and actions following named existing components.
- **Type consistency:** `ReminderStage` defined in T1, imported in T2/T6; `nextReminderStage`/`confirmByMs`/`markReminderSent`/`reminderStagesSent`/`clearConfirmation`/`clearConfirmReminders` names consistent across T2/T5/T6/T9; settings fields `requireConfirmation`/`confirmByHours` consistent T2/T3/T5/T6.
