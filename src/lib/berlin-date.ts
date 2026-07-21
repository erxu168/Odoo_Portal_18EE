// Single source of truth for "today" in the restaurant's local timezone.
//
// The servers run on UTC, but the business day is Europe/Berlin. Every
// "what day / weekday is it?" decision — dating a count session, deciding if a
// weekly list runs today, the tablet's date filter — must agree on Berlin.
// When they don't, they diverge for the hours around midnight (UTC vs Berlin)
// or whenever a device is set to another timezone. Import from here on both the
// server and the client so a single rule governs all of them.
const BERLIN = 'Europe/Berlin';

function berlinNow(): Date {
  // Same locale-string trick already used across the codebase; kept for
  // consistency. Reinterprets "now" as a Date in Berlin wall-clock time.
  return new Date(new Date().toLocaleString('en-US', { timeZone: BERLIN }));
}

/** Current Berlin day as YYYY-MM-DD. */
export function berlinToday(): string {
  const d = berlinNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Current Berlin weekday: 0=Sun, 1=Mon, … 6=Sat. */
export function berlinWeekday(): number {
  return berlinNow().getDay();
}

/**
 * Strict calendar-day check: a string 'YYYY-MM-DD' that round-trips through a
 * real UTC date — rejects impossible days like 2026-02-31 (which Date would
 * silently roll into March) and non-string values.
 */
export function isCanonicalDay(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(d + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}
