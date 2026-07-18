// =============================================================================
// Fully-loaded shift labour cost, incl. employer (AG / Arbeitgeber) on-costs.
// Pure + unit-testable so the manage route (and any future caller) share ONE
// definition. Cost = hours × €/h × (1 + agPct/100), rounded to cents.
// NOTE: a planning estimate, not a payroll calculation — real employer
// contributions vary by insurer, levies, ceilings and the employee's situation.
// =============================================================================

/**
 * German statutory minimum wage (€/h) effective on a Berlin date "YYYY-MM-DD".
 * The planner spans past + future weeks, so open-shift estimates use the rate
 * that applies on the shift's own date, not today's.
 * Source: BMAS Mindestlohn schedule.
 */
const MIN_WAGE_SCHEDULE: ReadonlyArray<{ from: string; eur: number }> = [
  { from: '2027-01-01', eur: 14.6 },
  { from: '2026-01-01', eur: 13.9 },
  { from: '2025-01-01', eur: 12.82 },
];

export function minimumWageForDate(date: string): number {
  for (const r of MIN_WAGE_SCHEDULE) {
    if (date >= r.from) return r.eur;
  }
  return MIN_WAGE_SCHEDULE[MIN_WAGE_SCHEDULE.length - 1].eur; // before the earliest known step
}

/**
 * Round a (non-negative) euro amount to whole cents, half-up. The 1e-9 nudge
 * corrects binary under-representation of exact .5-cent boundaries — e.g.
 * 9.075 stored as 9.07499999… would otherwise floor to 9.07.
 */
export function roundCents(n: number): number {
  return Math.round(n * 100 + 1e-9) / 100;
}

/** Fully-loaded cost of one shift, rounded to cents. `agPct` is a percentage (e.g. 21). */
export function shiftLabourCost(hours: number, hourlyRate: number, agPct: number): number {
  return roundCents(hours * hourlyRate * (1 + agPct / 100));
}
