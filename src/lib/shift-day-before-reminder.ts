// =============================================================================
// Day-before shift reminder — pure scheduling + grouping helpers.
// No I/O: the cron resolves times/slots and passes plain values in, so the
// tricky calendar + due-window logic is unit-testable. Dates are Berlin
// wall-clock "YYYY-MM-DD".
// =============================================================================

/** The evening send window is one hour wide (the cron runs hourly). */
export const DUE_WINDOW_MS = 3_600_000;

/** The Berlin calendar date one day AFTER a plain "YYYY-MM-DD" (pure string math). */
export function nextDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * True only during the one-hour window that starts at the configured send time:
 * scheduledMs ≤ now < scheduledMs + 1h. This fires the reminder once around the
 * set time and avoids a late-night backfill if the cron catches up hours later.
 */
export function isDueNow(scheduledMs: number, nowMs: number, windowMs: number = DUE_WINDOW_MS): boolean {
  return scheduledMs <= nowMs && nowMs < scheduledMs + windowMs;
}

/** Group items by employeeId, each group sorted by start time (earliest first). */
export function groupByEmployee<T extends { employeeId: number; startMs: number }>(items: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const it of items) {
    const arr = m.get(it.employeeId);
    if (arr) arr.push(it);
    else m.set(it.employeeId, [it]);
  }
  for (const arr of Array.from(m.values())) arr.sort((a, b) => a.startMs - b.startMs);
  return m;
}
