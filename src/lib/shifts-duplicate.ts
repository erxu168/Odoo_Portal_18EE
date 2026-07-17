// =============================================================================
// Shift-plan duplication — pure target-date expansion + count-aware dedup.
// No I/O: the API route reads source/target slots from Odoo + portal SQLite and
// passes plain specs in, so every calendar edge case is unit-testable here.
// Dates are Berlin wall-clock "YYYY-MM-DD"; times are "HH:MM".
// =============================================================================

export type RepeatMode = 'once' | 'weekly_until';

/** A shift reduced to the fields that define "the same shift" for duplication. */
export interface DupSpec {
  date: string; // YYYY-MM-DD (Berlin)
  start: string; // HH:MM
  end: string; // HH:MM
  roleId: number | null;
  deptId: number | null;
  minSkill: string | null; // '2' | '3' | null
  note: string;
}

/** Add `n` days to a plain YYYY-MM-DD date (DST-safe: no time component). */
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * The target dates a single source date duplicates onto.
 * - `once`        → the same weekday one week later (source + 7).
 * - `weekly_until`→ source + 7·n for n = 1,2,… while ≤ `until` (inclusive),
 *   capped at `maxWeeks`. An `until` mid-week yields a partial final week.
 */
export function targetDatesFor(
  srcDate: string,
  mode: RepeatMode,
  until: string | null,
  maxWeeks: number,
): string[] {
  if (mode === 'once') return [addDaysISO(srcDate, 7)];
  if (!until) return [];
  const out: string[] = [];
  for (let n = 1; n <= maxWeeks; n++) {
    const d = addDaysISO(srcDate, 7 * n);
    if (d > until) break; // YYYY-MM-DD compares lexicographically
    out.push(d);
  }
  return out;
}

/**
 * Count-aware identity of a shift on a date. Deliberately uses ONLY fields that
 * stay constant when a copy is later assigned or published: date, time, role,
 * note. Department and min-skill are excluded because assigning a shift clears
 * its skill gate and can swap in the assignee's derived department — including
 * them would make a re-run think an assigned copy is a different shift and
 * duplicate it. (Also makes retry after a partial create idempotent.)
 */
export function dupKey(s: DupSpec): string {
  return [s.date, s.start, s.end, s.roleId ?? '', s.note].join('|');
}

/**
 * Expand the selected source slots across the repeat horizon, then drop any copy
 * that already exists in the target weeks. Count-aware: two identical source
 * shifts need two matching target shifts before both are considered present, so
 * intentional headcount is preserved and re-running never double-books.
 */
export function planDuplicates(opts: {
  sources: DupSpec[];
  existing: DupSpec[];
  mode: RepeatMode;
  until: string | null;
  maxWeeks: number;
}): { toCreate: DupSpec[]; skipped: number; targetDates: string[] } {
  const { sources, existing, mode, until, maxWeeks } = opts;

  const candidates: DupSpec[] = [];
  const targetDateSet = new Set<string>();
  for (const s of sources) {
    for (const td of targetDatesFor(s.date, mode, until, maxWeeks)) {
      candidates.push({ ...s, date: td });
      targetDateSet.add(td);
    }
  }

  const existCount = new Map<string, number>();
  for (const e of existing) {
    const k = dupKey(e);
    existCount.set(k, (existCount.get(k) ?? 0) + 1);
  }

  const candByKey = new Map<string, DupSpec[]>();
  for (const c of candidates) {
    const k = dupKey(c);
    const arr = candByKey.get(k);
    if (arr) arr.push(c);
    else candByKey.set(k, [c]);
  }

  const toCreate: DupSpec[] = [];
  let skipped = 0;
  for (const cands of Array.from(candByKey.values())) {
    const have = existCount.get(dupKey(cands[0])) ?? 0;
    const make = Math.max(0, cands.length - have);
    for (let i = 0; i < cands.length; i++) {
      if (i < make) toCreate.push(cands[i]);
      else skipped++;
    }
  }

  return { toCreate, skipped, targetDates: Array.from(targetDateSet).sort() };
}
