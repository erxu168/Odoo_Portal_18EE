# Day Timeline (Gantt) View — design

**Date:** 2026-07-14
**Module:** Krawings Portal — shift planning, ManageShifts Day view (manager)
**Status:** design approved (owner picked the two forks)

## Goal
Replace the Day view's grouped chip-list with a **timeline**: a horizontal time axis for the day, each shift a bar sized by its start→end, stacked one-per-row, so a manager sees coverage and gaps at a glance.

## Locked decisions (owner)
1. **Replace** the Day list with the timeline (Day view always shows the timeline; Week/Month unchanged).
2. **One bar per shift**, ordered by start time (not per-person lanes).

## Layout
- **Time axis:** dynamic range for the selected day = floor(earliest shift start, in hours) … ceil(latest shift end). A shift whose end wall-clock is ≤ its start (crosses midnight) is positioned with end+24h and the range extends past 24 (e.g. to 26:00 = 02:00). Minimum span 6h so a single short shift still reads. Hour gridlines + labels along the top (label every hour if it fits, else every 2h).
- **Rows:** one per shift, sorted by (start, end). Each row is `~44px` tall (tap target). The bar: `left = (startMin − rangeStartMin) / spanMin`, `width = durationMin / spanMin` (min width so the label/tap works). Bar shows role/shift name · time range · assignee ("Open" if unassigned), truncated.
- **Colours (reuse existing status scheme):** assigned = blue fill; open = dashed/tinted; over-cap = red with "!"; cover-pending = amber dot. Same legend already under the view.
- **Now line:** a thin vertical marker at the current Berlin time when the selected day is today and within range.
- **Header:** keep the day's total-hours line ("21.5 h · assigned + open"). Department shown as a small label on each bar only if the day spans >1 department (WAJ is single-dept → omit).
- **Empty day:** existing empty state ("No shifts this day").

## Interactions
- Tap a bar → the existing `setEditSlot(slot)` edit/reassign sheet (unchanged).
- The bottom **New shift** button remains the add path. (Inline per-role "+" is removed with the list — accepted tradeoff of "replace".)

## Mobile-first
- The timeline lives in a horizontal-scroll container (`overflow-x:auto`) with a comfortable min width (e.g. `max(100%, span_hours × ~64px)`), so bars stay readable on a phone and the manager scrolls the day. Hour labels scroll with the bars. Rows stack vertically (normal page scroll).
- No hover-only affordances; bars use `:active`.

## Scope
- Only the **Day** view rendering changes (a new `dayTimeline(date)` renderer swapped in where `renderDayRows(date)` was used for day mode). Week/Month, the day picker, By-role/By-person toggle semantics, data fetching, and the edit sheet are untouched. (By-role/By-person no longer changes the day body; keep the toggle only if it still affects Week — otherwise hide it in Day.)
- No API/data-model changes; uses the ShiftSlot list already loaded.

## Verify
- Build clean (tsc + lint). Browser on staging (WAJ, the exact day in the screenshot): three bars (Opening 10:30–17, Mid day 12–21, late Evening 17–23) at correct positions/widths; tap opens the edit sheet; horizontal scroll on a narrow viewport; now-line on today. Screenshot.
