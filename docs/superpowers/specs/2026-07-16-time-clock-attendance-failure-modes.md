# Time Clock — attendance failure modes & hardening

**Date:** 2026-07-16
**Status:** analysis + hardening backlog (companion to the state-machine design)
**Visual version:** https://claude.ai/code/artifact/877b7767-bc0a-4722-9113-f2f7c9115d56

## Root cause
The clock is a **blind toggle**: each punch flips a person in↔out based on one question —
is there an open (no `check_out`) `hr.attendance` record? It has no awareness of the day,
the shift, or intent. `openAttendanceId(employeeId)` grabs the most recent open record from
**any day, any company**. So one missed tap doesn't lose one entry — it inverts every tap
after it until a manager untangles it. There is also no grace period, no auto-close of
forgotten punches, and the open record is tracked **per employee, not per restaurant**.

Severity key: **Critical** = wrong pay / corrupt records · **High** = misuse, fraud or
compliance · **Medium** = edge case / noise.

## Group 01 — Forgotten & double taps (the toggle trap)
- **F-01 Forgets to clock out** — *Critical.* Record stays open forever; person shows
  "still working"; hours balloon to a ~16 h shift.
- **F-02 Forgets to clock out, clocks in next day** — *Critical.* Today's tap closes
  yesterday's record at this morning's time (one giant overnight shift), today's real
  arrival goes unrecorded, and every later punch is now labelled backwards.
- **F-03 Forgets to clock in** — *High.* Hours undercounted, shows "off"; the end-of-shift
  tap creates a NEW clock-in at leaving time → phantom open record.
- **F-04 Double-tap on arrival** — *High.* Second tap clocks straight back out → 0-minute
  shift; person thinks they're in, they're out.
- **F-05 Double-tap on leaving** — *Medium.* Second tap creates a fresh clock-in at leaving
  time → another open record left running.

## Group 02 — Breaks
Today there is **no break concept** — a break is "clock out + back in" (two records).
- **B-01 Forgets to clock back in after break** — *High.* The break-out becomes the end of
  shift; the rest of the real shift is unpaid and unrecorded.
- **B-02 Never clocks out for the break** — *High / legal.* Break silently paid, no record it
  happened; ArbZG requires a provable 30 min (>6 h) / 45 min (>9 h) unpaid break.
- **B-03 Break-button state violations** — *High.* Start break → clock out (skip end);
  double "start break"; "end break" with none running; forget to end → runs forever / counts
  as work.
- **B-04 Break used to slip out** — *Medium.* Legal (unpaid) but unverified — on break vs gone.

## Group 03 — Someone punching for someone else
- **P-01 Buddy punching** — *Critical / fraud.* Anyone with a colleague's PIN clocks them
  in/out; nothing ties the tap to the real person.
- **P-02 Shared / guessable PINs** — *High.* Attribution becomes unreliable.
- **P-03 Malicious clock-out** — *Medium.* Prank/grudge clock-out cuts a colleague's hours.

## Group 04 — Nights & the calendar
- **C-01 Shift crosses midnight** — *Medium.* Clock-out lands next day; per-day shift
  matching gets lateness/overtime wrong for overnight shifts (known limitation).
- **C-02 Sunday → Monday rollover** — *Medium.* Week key flips at midnight Sun; overnight
  shift's second half can't find its slot.
- **C-03 Daylight-saving change** — *Medium.* An hour appears/vanishes; +1 h autumn, −1 h
  spring; a punch either side can even look like out-before-in.

## Group 05 — Multi-restaurant staff
- **M-01 Cross-location interference** — *High.* The open record is per person, not per
  restaurant. Clock in at A, tap at B → B clocks the person out of A (writes A's end-time
  on B's device). Confirmed in code (`openAttendanceId` has no company filter).

## Group 06 — Padding & gaming
- **G-01 Clock in early, clock out late** — *High.* If pay follows the clock, free minutes at
  each end add up; needs shift-bounded pay or approval.
- **G-02 Clock in, then leave the premises** — *High.* Paid-while-absent is invisible (no
  presence check).
- **G-03 No grace period** — *Medium.* 1 min late is flagged; buries real issues in noise and
  invites gaming the exact minute.

## Group 07 — Technical & day-to-day reality
- **T-01 No easy way to fix a mistake** — *High / ops.* Every wrong punch needs a manager
  editing Odoo's raw backend; errors pile up.
- **T-02 Tablet or Wi-Fi down** — *Medium.* Punches are server-side, so an outage = nobody
  can clock in (gap, or a rush of late punches).
- **T-03 Rapid taps / network retry** — *Medium.* Read-open-then-write isn't atomic; a
  double-submit or timed-out-but-succeeded retry can double-toggle or leave two open records.

## Hardening (roughly by impact)
1. **Show the state, offer only the valid next move** (state machine) — solves F-01,F-03,F-04,F-05,B-03.
2. **Day-boundary rule** — a previous-day open record isn't closed at today's time; auto-close + flag, start fresh — solves F-02,C-01,C-02.
3. **Nightly auto-close + review queue** — close anyone still open past shift end + grace / MAX_SHIFT, flag, never silently guess — solves F-01,B-01,G-02.
4. **Sanity checks at the punch** — confirm a clock-out over MAX_SHIFT; flag near-zero shifts — solves F-01,F-04,T-03.
5. **Breaks as a first-class state** with legal transitions + auto-end + separate storage — solves B-01,B-02,B-03.
6. **Manager "fix a punch" screen** in the portal (edit/close/add + reason + audit) — solves T-01 + cleanup of everything.
7. **Grace & rounding** on late/overtime — solves G-01,G-03.
8. **Scope the open record to the restaurant** (or warn on foreign-location open) — solves M-01.
9. **Decide the buddy-punching stance** (policy + hardware: photo-on-punch w/ consent, per-person PIN + presence-board spot checks, or a fixed supervised device) — solves P-01,P-02,P-03.
10. *(Optional)* offline capture — T-02.

Build order: fixes 1 → 2 → 3 first; they remove most daily pain and are the foundation the
break button slots into. Full design in `2026-07-16-time-clock-state-machine-design.md`.
