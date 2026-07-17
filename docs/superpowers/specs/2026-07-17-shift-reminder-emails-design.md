# Shift Reminder Emails + One-Tap Confirm (design)

**Date:** 2026-07-17
**Module:** Krawings Portal — shift planning ("Planning"). **Target: What a Jerk = company 6.**
**Status:** built on `main`, pending staging verification.

## Goal
Email staff a reminder before their shift with a **one-tap "I'll be there" link** that confirms
**without logging in**, resent on a fixed cadence **until they confirm**. Extends the existing
2026-07-11 shift-confirmation feature (push + in-app + manager board) — it does not replace it.

## Locked decisions (owner, 2026-07-17)
1. **Channels:** email (carries the confirm link) **plus** the existing web-push + in-app nudges.
2. **Cadence:** three staff checkpoints — **evening-before ~18:00 → morning-of ~09:00 → ~3h-before**
   (fire only the *latest-due* checkpoint, never backfill a burst), honoring **quiet hours 22:00–08:00
   Berlin**. Independently, the **manager is alerted once** at the confirm-by cutoff and always has the
   "Not yet confirmed" board. Not an unbounded resend (avoids spam / deliverability rot).
3. **First send:** the evening before.

## Company-id finding (resolved the long-standing 5-vs-6 ambiguity)
Live Odoo `res_company`: **5** "What a Jerk" (0 employees, 0 slots — empty shell), **6** "What a Jerk
(Kottbusser Damm 96)" (**12 employees, 107 future slots — the real venue**), **7** "WAJ ALT" (empty).
→ **Use company 6.** `CLAUDE.md`'s "5 = What a Jerk" points at a dead entity; the 2026-07-08 shift
spec's "company 6" was correct.

## Reused as-is
`shift_confirmations` + `confirmSlot`/`confirmedSlotIds`; the cron shell + token-auth + dedup table
`shift_confirm_reminders`; `getShiftSettings`/`saveShiftSettings`; the manager board
(`/api/shifts/unconfirmed`) + `notifyManagers`; `notifyEmployee` (push + in-app); the SMTP + branded-
template infra in `src/lib/email.ts`; the random-hex token-table pattern (`kiosk_pin_reset_tokens`);
Berlin/DST helpers `berlinParts`, `berlinDateTimeToUtcOdoo`, `odooToDate`.

## New / changed
- **`src/lib/shift-confirm.ts`** (pure, unit-tested): replaced the old `first`/`reminder` model with
  `nextStaffCheckpoint()` (evening/morning/final, latest-due-unsent, quiet-gated) + `managerOverdueDue()`
  (decoupled one-time escalation) + `inQuietWindow()`. `confirmByMs` kept (used by the board).
  `ReminderStage = 'evening'|'morning'|'final'|'overdue_mgr'`.
- **`shift_settings`** (additive `ALTER TABLE`): `reminder_email_enabled`, `reminder_evening_time`
  (`18:00`), `reminder_morning_time` (`09:00`), `reminder_final_lead_hours` (`3`), `reminder_quiet_start`
  (`22:00`), `reminder_quiet_end` (`08:00`). Wired through `ShiftSettings` type, get/save, the settings
  API, and the ShiftSettings UI (shown when confirmation is on).
- **`shift_confirm_tokens`** table + `getOrCreateShiftConfirmToken` / `resolveShiftConfirmToken` /
  `clearShiftConfirmTokens`. 32-byte random hex, one live token per (slot, employee), reused across a
  shift's emails, expires 6h after the shift. **Not consumed on use** (confirm is idempotent).
- **`sendShiftReminderEmail()`** — branded email with a green "Confirm — I'll be there ✅" button.
- **`POST /api/shifts/confirm/email` { token }** — no-login, idempotent confirm; returns the shift
  summary; 200 + `ok:false` for invalid/expired/reassigned so the page renders friendly.
- **`/confirm-shift` page** — public, `'use client'`, reads `?token=`, **POSTs on mount** (so a no-JS
  link-scanner never auto-confirms — avoids GET-mutation prefetch), shows ✅ or a plain-language error.
- **`fetchEmployeeEmails()`** — batch `hr.employee` → `work_email || private_email`.
- **Cron** rewritten: per unconfirmed assigned future slot, compute the 3 Berlin checkpoints; fire the
  due staff stage via in-app + push + (if enabled and the staffer has an email) a reminder email with a
  fresh confirm link; independently fire the one-time manager alert at the cutoff. Stays hourly.

## Cadence math (per shift, Berlin wall clock, DST-safe)
- `eveningMs = berlinDateTimeToUtcOdoo(dayBefore(startDate), reminder_evening_time)`
- `morningMs = berlinDateTimeToUtcOdoo(startDate, reminder_morning_time)`
- `finalMs = start − reminder_final_lead_hours`
- Fire the **latest** checkpoint with `time ≤ now` that hasn't been sent (never backfills); suppressed
  while `now` is inside the quiet window. `overdue_mgr` once when `now ≥ start − confirm_by_hours`.

## Edge cases
- **Feature just enabled / late-published shift:** latest-due-only ⇒ a single nudge, no burst.
- **Overnight/early shift:** morning-of/final may fall after start or in quiet hours and are skipped;
  the evening-before nudge still lands. Acceptable.
- **Reassigned slot:** the confirm endpoint checks the slot is still assigned to the token's employee
  (`reassigned` otherwise); stale tokens can't confirm for the wrong person.
- **No email on file:** email skipped for that staffer; push + in-app + board still cover them.
- **Link prefetch by email scanners:** page POSTs via JS on mount, so a plain GET never confirms.
- **Quiet hours:** staff only; the manager alert (once, with lead time) is not quiet-gated.

## Settings / deploy
- SQLite migrations are additive and run on boot. Feature is **off by default** per company.
- Enable on **company 6** in ShiftSettings → "Require shift confirmation" + "Email reminders".
- Requires SMTP configured (Admin → Email settings) and `PORTAL_URL` set for correct confirm links.
- Cron already scheduled hourly: `0 * * * * curl -s "http://localhost:3000/api/cron/shift-confirm-reminders?token=$CRON_SECRET"`.

## Verification
- Unit: 15/15 pass (checkpoint selection incl. latest-due/no-backfill, manager escalation, quiet window).
- Staging (co6): enable, assign+publish a near-future shift, run the cron, receive the email, click the
  link → `/confirm-shift` shows ✅ and the board row clears; re-click stays friendly; expired/reassigned
  render errors. Playwright real-browser per repo rule before prod.
