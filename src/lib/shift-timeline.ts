/** Pure geometry for drag-to-create on the day timeline (no DOM; unit-tested). */

export const SNAP_MIN = 15;
export const MIN_DURATION_MIN = 30;

export function snapTo(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

/** Absolute minutes (may exceed 1440 for an overnight end) → "HH:MM", mod 24h. */
export function minutesToHHMM(min: number): string {
  const n = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * From a drag anchor + current position (raw minutes) within an allowed
 * [rangeMin, rangeMax] window, produce a snapped {startMin, endMin}:
 * ordered (reverse-drag safe), 15-min snapped, at least MIN_DURATION_MIN long,
 * and shifted inward if enforcing the minimum would leave the window.
 */
export function computeSweep(
  anchorMin: number,
  currentMin: number,
  rangeMin: number,
  rangeMax: number,
): { startMin: number; endMin: number } {
  const clamp = (v: number) => Math.min(rangeMax, Math.max(rangeMin, v));
  const a = snapTo(clamp(anchorMin));
  const c = snapTo(clamp(currentMin));

  let start: number;
  let end: number;
  if (c >= a) {
    start = a;
    end = Math.max(c, a + MIN_DURATION_MIN);
  } else {
    start = Math.min(c, a - MIN_DURATION_MIN);
    end = a;
  }
  // Enforcing the minimum may push an endpoint past the window — shift inward.
  if (end > rangeMax) {
    end = rangeMax;
    start = Math.min(start, end - MIN_DURATION_MIN);
  }
  if (start < rangeMin) {
    start = rangeMin;
    end = Math.max(end, start + MIN_DURATION_MIN);
  }
  return { startMin: start, endMin: end };
}
