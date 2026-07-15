/**
 * What a Jerk — Sales dashboard: pure time/range helpers.
 *
 * No Odoo / SQLite / server imports so it can be unit-tested in isolation.
 * All Berlin conversions are DST-correct (via Intl, not a fixed +1 offset).
 */

export type Range = 'today' | 'week' | 'month' | 'ytd' | 'year';

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

// ── wall-clock-preserving instant shifts (DST- and leap-safe) ──
// Shifting a comparison window by adding raw milliseconds drifts across DST and
// leap boundaries. Instead we read the Berlin civil date/time, shift the
// calendar field, and rebuild the instant — so "one year / month / week earlier"
// keeps the same wall-clock time and calendar position.
function berlinWall(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  let h = parseInt(p.hour, 10);
  if (h === 24) h = 0;
  return { y: +p.year, mo: +p.month, d: +p.day, h, mi: +p.minute, s: +p.second };
}
function berlinInstant(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = berlinOffsetHours(naive);
  let ms = naive - o1 * 3600 * 1000;
  const o2 = berlinOffsetHours(ms);
  if (o2 !== o1) ms = naive - o2 * 3600 * 1000;
  return ms;
}
function daysInMonth(y: number, mo: number): number { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

export function shiftDays(ms: number, n: number): number {
  const w = berlinWall(ms);
  const nd = new Date(Date.UTC(w.y, w.mo - 1, w.d + n));
  return berlinInstant(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), w.h, w.mi, w.s);
}
export function shiftMonths(ms: number, n: number): number {
  const w = berlinWall(ms);
  const idx = (w.mo - 1) + n;
  const ny = w.y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12 + 1;
  return berlinInstant(ny, nm, Math.min(w.d, daysInMonth(ny, nm)), w.h, w.mi, w.s);
}
export function shiftYears(ms: number, n: number): number { return shiftMonths(ms, n * 12); }
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

export function monthFirst(day: string): string { return day.slice(0, 8) + '01'; }
export function firstOfNextMonth(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
/** Same YYYY-MM-DD shifted by `delta` years, clamping Feb 29 -> Feb 28. */
export function shiftYearDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const ny = y + delta;
  const maxD = new Date(Date.UTC(ny, m, 0)).getUTCDate();
  return `${ny}-${String(m).padStart(2, '0')}-${String(Math.min(d, maxD)).padStart(2, '0')}`;
}

export interface Bounds {
  range: Range;
  gran: 'hour' | 'day' | 'month';
  weekly: boolean;   // day-granularity: label by weekday (week) vs day-of-month (month)
  anchorDay: string;
  curStartMs: number; curEndMs: number;
  prevStartMs: number; prevEndMs: number; prevLabel: string; // '' => no previous-period delta
  yoyStartMs: number; yoyEndMs: number; yoyLabel: string;     // '' => no year-on-year delta
  sub: string;
}

/**
 * Bounds for the selected range anchored at `anchorDay` (a day inside the target
 * period; also carries the selected year). Produces three windows:
 *   cur  — the period, up to `now` if it is the current period, else the full period
 *   prev — the previous comparable period, ending at the same civil point
 *   yoy  — the same period one year earlier, ending at the same civil point
 * Comparison endpoints are computed by wall-clock-preserving calendar shifts
 * (DST- and leap-safe); day-length differences clamp (e.g. Mar 30 vs Feb 28).
 */
export function computeBounds(range: Range, anchorDay: string, nowMs: number): Bounds {
  const today = berlinDayOf(nowMs);
  const anchor = anchorDay && anchorDay <= today ? anchorDay : today; // never in the future
  const todayMD = today.slice(5); // MM-DD, for the year-to-date endpoint

  let startDay: string, endExcl: string, sub: string, prevLabel = '', yoyLabel = '';
  let gran: 'hour' | 'day' | 'month' = 'day';
  let weekly = false;
  let prevShift: ((ms: number) => number) | null = null;
  let yoyShift: (ms: number) => number = (ms) => shiftYears(ms, -1);

  if (range === 'today') {
    startDay = anchor; endExcl = dayShift(anchor, 1);
    prevShift = (ms) => shiftDays(ms, -7); prevLabel = `vs last ${DOW[dowOf(anchor)]}`;
    yoyLabel = 'vs last year';
    gran = 'hour'; sub = `Today · ${labelDay(anchor)}`;
  } else if (range === 'week') {
    const ws = mondayOf(anchor); startDay = ws; endExcl = dayShift(ws, 7);
    prevShift = (ms) => shiftDays(ms, -7); prevLabel = 'vs last week';
    yoyShift = (ms) => shiftDays(ms, -364); yoyLabel = 'vs same week last year'; // 52 weeks keeps the weekday
    weekly = true; sub = `Week of ${labelDay(ws)}`;
  } else if (range === 'month') {
    const mf = monthFirst(anchor); startDay = mf; endExcl = firstOfNextMonth(mf);
    prevShift = (ms) => shiftMonths(ms, -1); prevLabel = 'vs last month';
    yoyLabel = 'vs same month last year';
    sub = labelMonth(mf);
  } else if (range === 'ytd') {
    const yr = Number(anchor.slice(0, 4));
    // Year-to-date endpoint = today's month/day within the selected year,
    // clamped (handles today === Feb 29 in a non-leap selected year).
    const mm = Number(todayMD.slice(0, 2)), dd = Number(todayMD.slice(3, 5));
    const clampD = Math.min(dd, new Date(Date.UTC(yr, mm, 0)).getUTCDate());
    const ytdPoint = `${yr}-${String(mm).padStart(2, '0')}-${String(clampD).padStart(2, '0')}`;
    startDay = `${yr}-01-01`; endExcl = dayShift(ytdPoint, 1);
    yoyLabel = 'vs last year (YTD)';
    gran = 'month'; sub = `${yr} · year to date`;
  } else { // year
    const yr = Number(anchor.slice(0, 4));
    startDay = `${yr}-01-01`; endExcl = `${yr + 1}-01-01`;
    yoyLabel = `vs ${yr - 1}`;
    gran = 'month'; sub = `${yr}`;
  }

  const curStartMs = berlinMidnightMs(startDay);
  const curEndMs = Math.min(berlinMidnightMs(endExcl), nowMs);
  const [prevStartMs, prevEndMs] = prevShift ? [prevShift(curStartMs), prevShift(curEndMs)] : [0, 0];
  const [yoyStartMs, yoyEndMs] = [yoyShift(curStartMs), yoyShift(curEndMs)];

  return {
    range, gran, weekly, anchorDay: anchor,
    curStartMs, curEndMs,
    prevStartMs, prevEndMs, prevLabel,
    yoyStartMs, yoyEndMs, yoyLabel,
    sub,
  };
}
