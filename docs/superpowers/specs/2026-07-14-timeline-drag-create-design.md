# Drag-to-Create on the Day Timeline — design

**Date:** 2026-07-14
**Module:** Krawings Portal — shift planning, ManageShifts Day timeline (manager)
**Status:** design forks approved by owner; pending final nod + Codex plan reconcile

## Goal
On the Day timeline, let a manager **drag across the time axis to create a shift** — a live "ghost" bar follows the drag; on release, open the existing New Shift form prefilled with that day + swept start→end. Like dragging to make an event in Apple/Google Calendar.

## Locked decisions (owner)
1. **Touch = press-and-hold, then drag.** A brief still hold enters create-mode; then dragging sweeps the range. Keeps the timeline's sideways scroll for long days (matches Apple Calendar). Mouse = plain click-drag.
2. **Only a real drag creates.** A plain tap/click on empty space does nothing (the "+" button remains for tap-to-add). No accidental shifts.

## Behaviour
- Interactions happen on the **empty timeline background only** — existing bars keep tap→edit (`openSheet`) and long-press→quick menu; the create layer never fires when the gesture starts on a bar.
- **Mouse:** `mousedown` on empty bg → track; on move a ghost bar spans from the down-point to the cursor; `mouseup` → if the sweep ≥ a minimum, create; a plain click (negligible movement) does nothing.
- **Touch:** `touchstart`/`pointerdown` on empty bg starts a ~320 ms **hold timer**.
  - Finger moves > ~10 px **before** the timer fires → it's a scroll gesture: cancel create, let the container pan (don't preventDefault).
  - Timer fires (finger held still) → enter create-mode: `setPointerCapture`, show the ghost at the start point; subsequent moves sweep + `preventDefault` (suppress pan). Release → create.
  - A quick tap (up before timer, little movement) → nothing.
- **Snap** swept start & end to 15-minute increments. **Minimum** created duration 30 min (if the sweep is shorter, extend end to start+30). Clamp within the visible range.
- On release with a valid sweep: `onCreateShift({ date, startHHMM, endHHMM })` — the existing New Shift form opens prefilled; the actual planning.slot is created there (no new persistence path).
- **Ghost bar:** a translucent green bar with the live time label ("10:30 – 14:00") following the drag.

## Pixel → time
The timeline's inner scroll container has a known `rangeStart`/`rangeEnd` (minutes) mapped to its width. On a pointer event: `frac = (clientX − innerRect.left) / innerRect.width` (innerRect already accounts for horizontal scroll), `minutes = clamp(rangeStart, rangeEnd, rangeStart + frac × span)`, then snap to 15. Guard `width > 0`.

## Implementation (single file: `ManageShifts.tsx`)
- Add a full-width, full-height **create layer** div behind the bars inside the timeline rows container (bars render above it and stop propagation on their own handlers, so a press starting on a bar never reaches the layer).
- A `useRef` to the inner scroll container for `getBoundingClientRect()`; component state for `{ startMin, endMin, active }` drag session + the hold timer ref.
- `touch-action: pan-x` on the scroll container (horizontal scroll works); `touch-action: none` applied only while a capture/drag session is active.
- Reuse existing helpers: minute↔HHMM formatting, `onCreateShift(prefill)`, the 15-min snap.
- A subtle hint under the timeline: "Drag on the timeline to add a shift."

## Edge cases / pitfalls
- Don't hijack bar taps or the horizontal scroll (the hold-timer + movement-threshold is the disambiguator).
- iOS Safari: pointer capture + `preventDefault` on non-passive move; avoid `touch-action: none` on the whole timeline (kills scroll).
- Empty day (no shifts, so no computed range): use a sensible default range (e.g. 08:00–24:00) so a drag can still create.
- Pointer leaving the container mid-drag → clamp to range ends.
- A sweep entirely on a bar or that starts on a bar → ignored (edit/quick-menu owns it).

## Verify
- tsc + lint + build clean. Codex code-review of the diff. Browser (staging, WAJ): mouse click-drag creates a ghost and opens New Shift prefilled with the swept times; tapping an existing bar still edits; horizontal scroll still works; a plain click creates nothing. Playwright can drive a mouse drag; note touch long-press is validated manually.
