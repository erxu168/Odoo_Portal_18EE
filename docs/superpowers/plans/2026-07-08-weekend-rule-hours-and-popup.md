# Piece 2 — Fair-weekend rule + hour warnings + staff pop-up — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Staff must claim their equal share of Fri/Sat/Sun shifts before weekday shifts (auto-computed, server-enforced); a friendly warning when a claim exceeds weekly hours; and when a week is published, staff are notified (push + a guaranteed in-app pop-up) telling them exactly what to do.

**Architecture:** Pure quota engine (`shifts-weekend.ts`, unit-tested) consumed by `open` (grey-out weekday slots) and `claim` (hard 409). Weekend config + history in new SQLite tables. Publish notifies all schedulable staff. A staff "announcement" endpoint + modal on the Planning dashboard.

## Global Constraints
Same as Piece 1 (single branch `main`; `npm run build` before deploy; no Odoo model changes; manager-gated writes; Berlin/ISO-week helpers; Playwright before prod; snapshot before any test cleanup; portal green `#16a34a`).

Locked decisions: weekend share = **equal**; denominator = **eligible staff**; period = **single ISO week**; hours = **warn not block**.

## Interfaces
```ts
// src/lib/shifts-weekend.ts (PURE)
export const WEEKEND_DOWS = [5, 6, 7]; // Fri, Sat, Sun (ISO)
export function isWeekendDow(dow: number): boolean;
export interface WeekendSlotLite { id: number; roleId: number|null; minSkill: '2'|'3'|null; resourceId: number|null; }
export interface CohortEmp { id: number; resourceId: number|null; skill: '1'|'2'|'3'|null; roleIds: number[]; }
export interface WeekendGate { required: number; done: number; remaining: number; weekendSlotsAvailable: number; gateOpen: boolean; inCohort: boolean; }
export function computeWeekendGate(weekendSlots: WeekendSlotLite[], cohort: CohortEmp[], me: CohortEmp): WeekendGate;

// src/lib/shifts-db.ts (new)
export function getWeekendEnabled(companyId: number): boolean;   // default true
export function setWeekendEnabled(companyId: number, on: boolean): void;
export function weekendGateUnlockedAt(companyId: number, employeeId: number, periodKey: string): string | null;
export function upsertWeekendHistory(v: {companyId,employeeId,periodKey,quotaRequired,weekendWorked,gateUnlocked:boolean}): void;
```

## Tasks
- **T1** `shifts-weekend.ts` pure engine + `tests/shift-weekend.unit.spec.ts` (quota=ceil(W/N) capped by eligibility; remaining; W_unassigned==0 opens gate; not-in-cohort → open).
- **T2** SQLite: `shift_weekend_config(company_id PK, enabled)` + `shift_weekend_history(company_id,employee_id,period_key UNIQUE, quota_required, weekend_worked, gate_unlocked_at, updated_at)` + helpers. Grandfather = once gate_unlocked_at set, gate stays open.
- **T3** `open` route: for each ISO week present among open slots, fetch that week's published slots, build weekend gate for the viewer (apply grandfather), mark eligible weekday slots `eligible:false, reason:'weekend_first'`; weekend slots never gated. Add top-level `weekendGate` for the earliest week still owing. Skip entirely if `!getWeekendEnabled`.
- **T4** `claim` route: if slot is a weekday and gate not open → 409 `{error:'weekend_first', remaining, weekendSlotsAvailable}` (persist gate_unlocked_at when weekend quota met). Hour limit: `limit = me.cap ?? me.weeklyTarget`; keep the existing needsConfirm flow against `limit`.
- **T5** `OpenShiftsList.tsx`: red top banner when the earliest week owes weekend shifts ("Claim N weekend shift(s) to unlock weekday shifts"); `weekend_first` slots show a "Weekend first" badge + stay disabled; weekend-counting slots get a "Counts toward weekend" hint; reword the cap warning to "over your weekly hours"; handle the 409 `weekend_first` on claim.
- **T6** publish endpoint (`patterns/[id]/publish`): after publishing, notify every schedulable staff member (`notifyEmployee`, type `week_published`) with {weekLabel, deadline} → in-app + push.
- **T7** staff pop-up: `GET /api/shifts/announcement?company_id=` returns the active open run + the viewer's pending actions (weekendRemaining, openEligible, deadline); `StaffAnnouncement.tsx` modal shown on the Planning dashboard for staff with a pending open run (dismiss-per-run via localStorage) + a "Pick shifts" button. Add a weekend on/off toggle to `ShiftSettings`.
- **T8** deploy + real-browser verify on staging; clean up tagged test data.
