# Shift-Confirmation Nudges + Manager "Not Yet Confirmed" Board

**Date:** 2026-07-11
**Module:** Krawings Portal — shift planning (What a Jerk / co6 first)
**Status:** design approved (owner locked the two forks); pending spec review → plan

## Goal
Turn the existing silent "I'll be there" confirmation into an actively-chased signal so managers know, well before service, who has actually acknowledged their shifts — cutting last-minute no-shows. Builds on `shift_confirmations`, the `confirm` route, the VAPID web-push pipeline, and per-company `shift_settings`.

## Locked decisions (owner)
1. **Unconfirmed at cutoff → manager decides.** No auto-release. The shift stays assigned; it is flagged on the manager board and the manager is alerted. They choose to nudge, release, or leave it.
2. **Confirm-by cutoff is a per-restaurant setting** (default 24h before the shift).

## Scope (v1)
In scope:
- Per-company on/off toggle + configurable confirm-by hours.
- Staff can confirm their assigned, published shifts from their phone; unconfirmed ones are visibly flagged.
- Automatic reminder cadence to staff (web push + in-app notification).
- Manager "Not yet confirmed" board with per-shift actions: **nudge**, **release to open pool**, **mark confirmed** (on the staffer's behalf).
- Manager alert when a shift passes its cutoff still unconfirmed.

Out of scope (v1): auto-release, SMS/WhatsApp reminders, confirmation for open/unassigned shifts (only assigned shifts are confirmed).

## Data model
Reuse `shift_confirmations (slot_id PK, company_id, employee_id, confirmed_at)` = the source of truth for "confirmed". Unconfirmed = no row for that assigned slot.

Add:
- `shift_settings`: `require_confirmation INTEGER NOT NULL DEFAULT 0`, `confirm_by_hours REAL NOT NULL DEFAULT 24`. (ALTER TABLE, additive; existing rows default off.)
- `shift_confirm_reminders (slot_id INTEGER, stage TEXT, sent_at TEXT, PRIMARY KEY(slot_id, stage))` — dedup so the cron never double-sends a stage or double-alerts the manager. Stages: `first`, `reminder`, `overdue_mgr`.

"Needs confirmation" = a `planning.slot` that is **published + assigned (resource_id set) + starts in the future**, in a company with `require_confirmation=1`, with no `shift_confirmations` row.

## Reminder cadence (cron)
New `GET /api/cron/shift-confirm-reminders?token=<CRON_SECRET>` (same token-auth + crontab pattern as `/api/cron/prep-forecast`; run hourly). For each company with the feature on, over its unconfirmed assigned future shifts, with `confirmBy = start − confirm_by_hours`:
- **`first`** — first time the cron sees it unconfirmed: push staff "Please confirm you'll be there for {shift}."
- **`reminder`** — once we are within ~6h of `confirmBy` and still unconfirmed: a second, firmer staff push.
- **`overdue_mgr`** — once `now > confirmBy` and still unconfirmed: notify the company's manager(s) once (in-app + push) and mark the board row overdue. No further staff nagging.
Each stage is recorded in `shift_confirm_reminders` so it fires at most once per shift.

## APIs
- `GET /api/shifts/unconfirmed?company_id=` (manager) → unconfirmed assigned future shifts: employee, start/end, role/dept, `confirmBy`, `remindersSent`, `overdue` flag. Sorted soonest-first.
- `POST /api/shifts/confirm/nudge` { slot_id } (manager) → send an immediate staff push for that shift.
- `POST /api/shifts/confirm` — extend the existing confirm route to accept an optional `employee_id`/`on_behalf` so a **manager** can mark a shift confirmed for a staffer (audit-logged). Staff self-confirm path unchanged.
- **Release** reuses the existing unassign-to-open-pool mutation (set `resource_id` false → open) + `recomputeWeekFlags`; the board calls it. No new release logic.

## UI
- **Staff:** on the staff shifts view, assigned published shifts that need confirmation show a "Confirm you'll be there" button (and a subtle "unconfirmed" chip). Tapping calls the confirm route. Already-confirmed shifts show a check. The publish-time announcement pop-up gains a "confirm your shifts" line when confirmation is required.
- **Manager:** a "Not yet confirmed" tile on the Planning manager dashboard with an unconfirmed count badge → `UnconfirmedBoard` screen listing the shifts with the three per-row actions. Overdue rows are red.
- **Settings:** ShiftSettings (Planning gear) gains a "Require shift confirmation" toggle + a "Confirm by (hours before shift)" number, saved to `shift_settings`.

## Guardrails / edge cases
- Feature is **off by default** per company; nothing changes until a manager enables it.
- **No burst when first enabled:** the `first` staff nudge only targets shifts **starting within the next 7 days**. Shifts further out get their `first` nudge once they enter that window on a later cron run — so switching the feature on doesn't blast the whole published month at once.
- **Overdue alert target:** the company's managers via the existing `notifyManagers` helper (same one the over-cap claim path uses), once per shift.
- Releasing a shift and marking-confirmed both re-validate live (slot still assigned to that person) to stay concurrency-safe, consistent with `shifts-guards.ts`.
- If a shift is unassigned/cover-swapped, its confirmation + reminder rows are cleared so the new assignee starts fresh.
- Reminders/alerts are best-effort (push may fail) — the manager board is the reliable source of truth.

## Deploy
- SQLite migrations run on boot (ALTER TABLE additive + new table).
- Add the cron line on staging: `0 * * * * curl -s "http://localhost:3000/api/cron/shift-confirm-reminders?token=$CRON_SECRET"`.

## Verification
- Unit: reminder-stage selection (given start, confirm_by_hours, now, sent-stages → which stage fires) as a pure function.
- End-to-end on staging: enable for co6, assign+publish a near-future shift, run the cron, confirm the staff push + board row; test nudge/release/mark-confirmed; let one pass the cutoff and confirm the manager alert + overdue flag. Clean up test data.
