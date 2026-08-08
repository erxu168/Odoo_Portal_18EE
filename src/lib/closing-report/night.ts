// Closing Report — the night boundary.
//
// A closing report belongs to the EVENING it closes, even when the close runs
// past midnight: a report submitted at 00:30 is about the night that started
// the previous calendar day. The same 05:00 line is the edit lock — the
// submitter may correct the report until 05:00 Berlin after its night, then it
// is the immutable record.
//
// The pure functions take explicit Berlin wall-clock parts so they unit-test
// without clocks; the exported wrappers read Berlin time the same way
// berlin-date.ts does.

const BERLIN = 'Europe/Berlin';

export const NIGHT_CUTOFF_HOUR = 5;

function berlinNowParts(): { day: string; hour: number } {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: BERLIN }));
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { day, hour: d.getHours() };
}

/** Shift a canonical YYYY-MM-DD by whole days (UTC arithmetic — no DST drift on dates). */
export function shiftDay(day: string, byDays: number): string {
  const t = Date.parse(day + 'T00:00:00Z') + byDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Pure core: which night does "now" belong to? Before 05:00 → the previous day. */
export function operationalDateFor(berlinDay: string, berlinHour: number): string {
  return berlinHour < NIGHT_CUTOFF_HOUR ? shiftDay(berlinDay, -1) : berlinDay;
}

/** Pure core: may a report for `reportDate` still be edited at the given Berlin moment? */
export function isWithinEditWindow(reportDate: string, berlinDay: string, berlinHour: number): boolean {
  return operationalDateFor(berlinDay, berlinHour) === reportDate;
}

/** The night the current moment belongs to (Berlin, 05:00 cutoff). */
export function closingOperationalDate(): string {
  const { day, hour } = berlinNowParts();
  return operationalDateFor(day, hour);
}

/** True while the submitter may still correct a report for `reportDate`. */
export function reportEditable(reportDate: string): boolean {
  const { day, hour } = berlinNowParts();
  return isWithinEditWindow(reportDate, day, hour);
}
