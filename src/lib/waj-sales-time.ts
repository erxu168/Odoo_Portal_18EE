/**
 * What a Jerk — Sales dashboard: pure time/range helpers.
 *
 * No Odoo / SQLite / server imports so it can be unit-tested in isolation.
 * All Berlin conversions are DST-correct (via Intl, not a fixed +1 offset).
 */

export type Range = 'today' | 'week' | 'month';

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BERLIN = 'Europe/Berlin';

/** Berlin day (YYYY-MM-DD), hour (0-23) and dow (0=Mon) for a UTC datetime string. */
export function berlinParts(utcStr: string): { day: string; hour: number; dow: number } {
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { day: `${p.year}-${p.month}-${p.day}`, hour, dow: map[p.weekday] ?? 0 };
}

/** Berlin local date (YYYY-MM-DD) for an epoch-ms instant. */
export function berlinDayOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Berlin UTC offset in hours at a given instant (DST-aware). */
function berlinOffsetHours(ms: number): number {
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: BERLIN, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value || 'GMT+1';
  const m = tz.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * UTC epoch-ms for Berlin local midnight of a given YYYY-MM-DD.
 * Uses the offset AT the candidate midnight instant (not noon), so it is correct
 * on the two DST-transition days as well.
 */
export function berlinMidnightMs(dayStr: string): number {
  const base = Date.parse(dayStr + 'T00:00:00Z');
  const off1 = berlinOffsetHours(base);
  let ms = base - off1 * 3600 * 1000;
  const off2 = berlinOffsetHours(ms);
  if (off2 !== off1) ms = base - off2 * 3600 * 1000;
  return ms;
}

export function utcStr(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
export function dayShift(dayStr: string, delta: number): string {
  const d = new Date(dayStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(dayStr: string): string {
  const d = new Date(dayStr + 'T12:00:00Z');
  const wd = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return dayShift(dayStr, -wd);
}
export function prevMonthFirst(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}
function dowOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export function labelDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${DOW[dowOf(day)]} ${d} ${MON[m - 1]}`;
}
export function labelMonth(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return `${MON[m - 1]} ${y}`;
}
export function weekdayLabel(day: string): string { return DOW[dowOf(day)]; }
export function dayOfMonthLabel(day: string): string { return String(Number(day.slice(8, 10))); }

export interface Bounds {
  range: Range;
  gran: 'hour' | 'day';
  startDay: string;
  curStartMs: number; curEndMs: number;
  prevStartMs: number; prevEndMs: number;
  sub: string; cmp: string;
}

export function computeBounds(range: Range, nowMs: number): Bounds {
  const today = berlinDayOf(nowMs);
  const curEndMs = nowMs;
  if (range === 'today') {
    const curStartMs = berlinMidnightMs(today);
    return {
      range, gran: 'hour', startDay: today, curStartMs, curEndMs,
      prevStartMs: berlinMidnightMs(dayShift(today, -7)),
      prevEndMs: curEndMs - 7 * 86400000,
      sub: `Today · ${labelDay(today)}`,
      cmp: `vs last ${DOW[dowOf(today)]} (same time)`,
    };
  }
  if (range === 'week') {
    const startDay = mondayOf(today);
    const curStartMs = berlinMidnightMs(startDay);
    return {
      range, gran: 'day', startDay, curStartMs, curEndMs,
      prevStartMs: berlinMidnightMs(dayShift(startDay, -7)),
      prevEndMs: curEndMs - 7 * 86400000,
      sub: `This week · from ${labelDay(startDay)}`,
      cmp: 'vs last week',
    };
  }
  const startDay = today.slice(0, 8) + '01';
  const curStartMs = berlinMidnightMs(startDay);
  const prevStartMs = berlinMidnightMs(prevMonthFirst(startDay));
  return {
    range, gran: 'day', startDay, curStartMs, curEndMs,
    prevStartMs,
    // Same elapsed window a month earlier, but never spill past the end of the
    // previous month (e.g. Mar 30 must not compare into early March).
    prevEndMs: Math.min(prevStartMs + (curEndMs - curStartMs), curStartMs),
    sub: `This month · ${labelMonth(startDay)}`,
    cmp: 'vs same period last month',
  };
}
