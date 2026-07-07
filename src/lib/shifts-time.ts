/**
 * Shifts module — Berlin-timezone and ISO-week helpers.
 *
 * Odoo stores datetimes as space-separated UTC-naive strings ("YYYY-MM-DD HH:MM:SS").
 * A shift belongs to the ISO week (Mon–Sun) of its start_datetime in Berlin wall
 * clock; duration itself is timezone-independent (end − start).
 *
 * DST-aware conversions use Intl.DateTimeFormat probe technique: try +02:00 (CEST)
 * then +01:00 (CET) and keep the offset that round-trips to the requested Berlin
 * wall-clock time. No external dependencies.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Parse an Odoo "YYYY-MM-DD HH:MM:SS" UTC-naive string into a JS Date. */
export function odooToDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z');
}

/** Format a JS Date as an Odoo "YYYY-MM-DD HH:MM:SS" UTC string. */
export function dateToOdoo(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Duration in hours between two Odoo datetimes, rounded to 2 decimals. */
export function durationHours(startOdoo: string, endOdoo: string): number {
  const ms = odooToDate(endOdoo).getTime() - odooToDate(startOdoo).getTime();
  return Math.round((ms / HOUR_MS) * 100) / 100;
}

/** Current time as an Odoo UTC string. */
export function nowOdooUtc(): string {
  return dateToOdoo(new Date());
}

// -- Berlin wall-clock parts ---------------------------------------------------

const BERLIN_PARTS_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

const DOW_MAP: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Berlin wall-clock parts of an Odoo UTC datetime.
 * dow: 1=Mon … 7=Sun (ISO numbering).
 */
export function berlinParts(odooDt: string): { date: string; hhmm: string; dow: number } {
  const parts = BERLIN_PARTS_FMT.formatToParts(odooToDate(odooDt));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // some ICU versions render midnight as 24
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${hour}:${get('minute')}`,
    dow: DOW_MAP[get('weekday')] ?? 1,
  };
}

// -- Calendar-date arithmetic (pure "YYYY-MM-DD" strings, no TZ involved) ------

function dateStrToUtcMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = dateStrToUtcMidnight(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// -- ISO 8601 week math (week 1 contains Jan 4; weeks start Monday) ------------

/** ISO year + week of a pure calendar date. */
function isoWeekOfDateStr(dateStr: string): { year: number; week: number } {
  const d = dateStrToUtcMidnight(dateStr);
  const dayNum = (d.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4 - jan4DayNum + 3));
  const week = 1 + Math.round((d.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return { year: isoYear, week };
}

function toWeekKey(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function parseWeekKey(weekKey: string): { year: number; week: number } {
  const m = weekKey.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) throw new Error(`[shifts] Invalid week key: ${weekKey}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

/** Berlin calendar date ("YYYY-MM-DD") of the Monday starting the given ISO week. */
function weekKeyMonday(weekKey: string): string {
  const { year, week } = parseWeekKey(weekKey);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(year, 0, 4 - jan4DayNum + (week - 1) * 7));
  return monday.toISOString().slice(0, 10);
}

/** ISO week key ("2026-W28") of an Odoo UTC datetime, in Berlin wall clock. */
export function berlinISOWeekKey(odooDt: string): string {
  const { year, week } = isoWeekOfDateStr(berlinParts(odooDt).date);
  return toWeekKey(year, week);
}

/** ISO week key of the current moment (Berlin wall clock). */
export function currentWeekKey(): string {
  return berlinISOWeekKey(nowOdooUtc());
}

/** Shift a week key by N weeks (negative = past). */
export function offsetWeekKey(weekKey: string, offset: number): string {
  const shiftedMonday = addDaysToDateStr(weekKeyMonday(weekKey), offset * 7);
  const { year, week } = isoWeekOfDateStr(shiftedMonday);
  return toWeekKey(year, week);
}

/** The 7 Berlin calendar dates ("YYYY-MM-DD") of a week, Monday … Sunday. */
export function weekKeyDays(weekKey: string): string[] {
  const monday = weekKeyMonday(weekKey);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(addDaysToDateStr(monday, i));
  return days;
}

// -- DST-aware Berlin wall clock → UTC ------------------------------------------

const BERLIN_ROUNDTRIP_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Convert a Berlin wall-clock date + time to an Odoo UTC string, DST-aware.
 * Probes CEST (+02:00) then CET (+01:00) and keeps the offset whose UTC instant
 * renders back to the requested Berlin wall clock. During the fall-back overlap
 * the earlier (CEST) occurrence wins; a spring-forward gap time falls back to
 * the +01:00 interpretation (lands just after the jump).
 */
export function berlinDateTimeToUtcOdoo(date: string, hhmm: string): string {
  const hm = hhmm.length === 4 ? `0${hhmm}` : hhmm; // tolerate "9:00"
  for (const off of ['+02:00', '+01:00']) {
    const d = new Date(`${date}T${hm}:00${off}`);
    const back = BERLIN_ROUNDTRIP_FMT.format(d); // "YYYY-MM-DD HH:mm:ss"
    if (back.startsWith(`${date} ${hm}`)) {
      return dateToOdoo(d);
    }
  }
  return dateToOdoo(new Date(`${date}T${hm}:00+01:00`));
}

/**
 * UTC range of an ISO week in Berlin wall clock:
 * Berlin Monday 00:00 (inclusive) → next Monday 00:00 (exclusive), DST-aware.
 */
export function weekKeyToUtcRange(weekKey: string): { startOdoo: string; endOdoo: string } {
  const monday = weekKeyMonday(weekKey);
  const nextMonday = addDaysToDateStr(monday, 7);
  return {
    startOdoo: berlinDateTimeToUtcOdoo(monday, '00:00'),
    endOdoo: berlinDateTimeToUtcOdoo(nextMonday, '00:00'),
  };
}

// -- Display formatting (German date feel, 24h) ---------------------------------

const BERLIN_DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "Fri 10 Jul" — Berlin wall clock. */
export function fmtDay(odooDt: string): string {
  const parts = BERLIN_DAY_FMT.formatToParts(odooToDate(odooDt));
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** "16:00–22:00" — Berlin wall clock, 24h, en dash. */
export function fmtTimeRange(startOdoo: string, endOdoo: string): string {
  return `${berlinParts(startOdoo).hhmm}–${berlinParts(endOdoo).hhmm}`;
}

// -- ArbZG assign-time checks -----------------------------------------------------

export const ARBZG_REST_MIN_H = 11; // §5 rest between shifts
export const ARBZG_DAILY_MAX_H = 10; // §3 daily maximum

/**
 * ArbZG conflicts a NEW shift (Berlin date + wall-clock times) would create for
 * a person, given their existing shifts (Odoo UTC strings). Returns plain-
 * English warnings: rest gap < 11h against a neighbouring shift, or the new
 * shift itself exceeding 10h. Overnight (end <= start) rolls to the next day.
 */
export function arbzgConflicts(
  existing: { start: string; end: string }[],
  date: string,
  startHHMM: string,
  endHHMM: string,
): string[] {
  const out: string[] = [];
  const startUtc = berlinDateTimeToUtcOdoo(date, startHHMM);
  const endDate = endHHMM <= startHHMM ? addDaysToDateStr(date, 1) : date;
  const endUtc = berlinDateTimeToUtcOdoo(endDate, endHHMM);
  const s = odooToDate(startUtc).getTime();
  const e = odooToDate(endUtc).getTime();

  if ((e - s) / HOUR_MS > ARBZG_DAILY_MAX_H + 1e-9) {
    out.push(`${Math.round(((e - s) / HOUR_MS) * 10) / 10}h shift — over the ${ARBZG_DAILY_MAX_H}h daily maximum`);
  }
  for (const ex of existing) {
    const exS = odooToDate(ex.start).getTime();
    const exE = odooToDate(ex.end).getTime();
    // Rest gap to a shift ending before this one starts…
    if (exE <= s) {
      const gap = (s - exE) / HOUR_MS;
      if (gap < ARBZG_REST_MIN_H) {
        out.push(`only ${Math.round(gap * 10) / 10}h rest after their ${fmtDay(ex.start)} shift (min ${ARBZG_REST_MIN_H}h)`);
      }
    }
    // …and to a shift starting after this one ends.
    if (exS >= e) {
      const gap = (exS - e) / HOUR_MS;
      if (gap < ARBZG_REST_MIN_H) {
        out.push(`only ${Math.round(gap * 10) / 10}h rest before their ${fmtDay(ex.start)} shift (min ${ARBZG_REST_MIN_H}h)`);
      }
    }
  }
  return out;
}
