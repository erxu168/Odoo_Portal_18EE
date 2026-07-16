# Time Clock / Break — state machine design

**Date:** 2026-07-16
**Status:** design (v1.1, red-teamed) — ready to build; pairs with the incoming iMac break-button work
**Visual version:** https://claude.ai/code/artifact/cbe9e325-a83d-447f-b974-be764a25e9d6
**Companion:** `2026-07-16-time-clock-attendance-failure-modes.md`

## Purpose
Replace the blind in/out toggle with an explicit state machine so a wrong tap is
impossible, breaks are first-class (ArbZG-provable), and forgotten punches are
contained (day-boundary + nightly auto-close), not propagated.

## States (per employee, per restaurant/company)
Derived server-side from records, never trusted from the client.
- **OFF** — no open attendance record for today.
- **WORKING** — open attendance record, no open break.
- **ON_BREAK** — open attendance record + an open (unpaid) break interval.

## Events (what a person can tap)
CLOCK_IN · CLOCK_OUT · START_BREAK · END_BREAK

## Transition table (server-enforced; UI shows only the allowed events)
| State | Event | Allowed | Record effect | → State |
|---|---|---|---|---|
| OFF | CLOCK_IN | ✅ | create attendance {check_in = server now, planning_slot_id?} | WORKING |
| WORKING | START_BREAK | ✅ | open break {break_start = now} | ON_BREAK |
| WORKING | CLOCK_OUT | ✅ | set check_out = now; finalize | OFF |
| ON_BREAK | END_BREAK | ✅ | set break_end = now | WORKING |
| ON_BREAK | CLOCK_OUT | ✅ | auto-close open break (break_end = now) → set check_out = now; flag `out_from_break` | OFF |
| any | (invalid event for the state) | ⛔ | rejected server-side (button never shown either) | unchanged |

Invalid events (all rejected, and never rendered): CLOCK_OUT/START_BREAK/END_BREAK
while OFF; CLOCK_IN/END_BREAK while WORKING; CLOCK_IN/START_BREAK while ON_BREAK.

## Data model (recommended)
One hr.attendance per work **session** (check_in → check_out). Breaks as intervals
in a portal table `kiosk_breaks(attendance_id, company_id, employee_id, break_start,
break_end, source)`. Paid time = (check_out − check_in) − Σ break durations. Keeps
one clean Odoo span per shift AND makes break totals provable. (Alt: breaks as
clock-out/in pairs → splits records; rejected — can't tell break from went-home, and
no break label for compliance.)

## Guards that contain forgotten / abusive punches
- **State derivation is day-aware.** If the only open attendance's check_in is from a
  *previous* day (or older than MAX_SHIFT), it is treated as STALE: a new tap does NOT
  close it at today's time — it's auto-closed+flagged and the person starts a fresh
  WORKING. (Kills the next-day "clock-in read as clock-out" trap.)
- **Nightly auto-close job.** Any record still open past shift-end + grace, or beyond
  MAX_SHIFT, is closed at the scheduled shift end (or CUTOFF), flagged
  `auto_closed_needs_review`; an open break is closed too. Never silently guess — flag.
- **Max break.** An open break beyond MAX_BREAK auto-ends + flags, so a forgotten break
  can't eat the shift or inflate paid time.
- **Punch-time confirmation.** CLOCK_OUT that would exceed MAX_SHIFT → "You clocked in
  14 h ago — clock out now?"; near-zero shifts flagged; CLOCK_IN while open elsewhere →
  warn/block (see multi-location).
- **Double-tap safety.** After CLOCK_OUT the screen shows a confirmation ("Clocked out ✓")
  and ignores taps for a few seconds, so a second tap can't immediately re-clock-in.
- **Multi-location.** Derive state per company; but before CLOCK_IN, check if the person
  is open at *another* company → warn/block ("still clocked in at <A>"). One clock at a time.
- **Atomicity / idempotency.** One server endpoint reads state + applies the transition in
  a single transaction; the client sends an action token so a retried/duplicate request is
  a no-op. (Kills double-toggle races.)
- **Record invariant (must hold on every write/close).** `check_in ≤ break_start ≤
  break_end ≤ check_out`. On auto-close set `check_out = max(scheduled_shift_end,
  latest break_end, now)` so the span always covers every break; drop-or-flag any break
  with `break_start ≥ check_out`; in the pay formula clamp each break to its intersection
  with `[check_in, check_out]` before subtracting and floor paid at 0 (flag, never emit a
  negative or out-of-span record). [red-team #1/#2]
- **Legal break check (ArbZG §4, done correctly).** Count only break blocks **≥ 15 min**
  toward the required 30/45 min (sub-15 fragments don't qualify). Compute the 6 h / 9 h
  tier on **worked time** = `(check_out − check_in) − Σ qualifying breaks`, strict `>6h` /
  `>9h`. Also flag any worked stretch **> 6 h with no intervening qualifying break**
  (placement, not just total). Store per-interval break durations so the manager report
  shows the qualifying blocks that prove compliance. [red-team #3–#6]

## Policy numbers to decide (with Ethan)
MAX_SHIFT (auto-close threshold, e.g. 14 h) · MAX_BREAK (e.g. 90 min) · GRACE for
late/overtime (e.g. ±5 min) · CUTOFF time for the nightly close (e.g. 04:00) · block vs
warn on second-location clock-in · enforce vs only-flag the ArbZG minimum break.

## Out of machine, still required
- **Manager "fix a punch" screen** (edit/close/add attendance + breaks, reason + audit).
- **Buddy punching** = policy/hardware decision (photo-on-punch w/ consent, per-person PIN
  discipline + presence-board spot checks, or a fixed supervised device). Not solved by
  the machine.
- Grace/rounding live in the pay/punctuality calc, not the machine.

## Failure-mode coverage (from the risk map)
F-01 forgot-out → nightly auto-close + confirm. F-02 next-day → day-aware derivation.
F-03 forgot-in / F-04,F-05 double-tap → explicit state + only-valid-actions + double-tap
guard. B-01 forgot-back-from-break → CLOCK_OUT auto-closes break + nightly job. B-02
no-break-record → breaks stored + ArbZG flag. B-03 break state violations → machine
forbids them. M-01 cross-location → per-company state + second-location block. G-01/G-03
padding/grace → grace layer. T-01 fixes → manager screen. T-03 races → atomic+idempotent.
(P-01..P-03 buddy punching + T-02 offline = separate decisions, noted.)
