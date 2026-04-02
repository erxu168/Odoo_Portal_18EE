/**
 * German public holidays calculator — national + Berlin-specific.
 * Computes fixed and moveable (Easter-based) holidays for any year.
 */

export interface PublicHoliday {
  date: Date;
  name: string;
  nameDE: string;
}

/**
 * Compute Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Get all public holidays for Berlin for a given year.
 * Includes national German holidays + Berlin-specific (Internationaler Frauentag).
 */
export function getBerlinHolidays(year: number): PublicHoliday[] {
  const easter = easterSunday(year);

  return [
    { date: new Date(year, 0, 1), name: "New Year's Day", nameDE: 'Neujahr' },
    { date: new Date(year, 2, 8), name: "International Women's Day", nameDE: 'Internationaler Frauentag' }, // Berlin only
    { date: addDays(easter, -2), name: 'Good Friday', nameDE: 'Karfreitag' },
    { date: addDays(easter, 1), name: 'Easter Monday', nameDE: 'Ostermontag' },
    { date: new Date(year, 4, 1), name: 'Labour Day', nameDE: 'Tag der Arbeit' },
    { date: addDays(easter, 39), name: 'Ascension Day', nameDE: 'Christi Himmelfahrt' },
    { date: addDays(easter, 50), name: 'Whit Monday', nameDE: 'Pfingstmontag' },
    { date: new Date(year, 9, 3), name: 'German Unity Day', nameDE: 'Tag der Deutschen Einheit' },
    { date: new Date(year, 11, 25), name: 'Christmas Day', nameDE: '1. Weihnachtstag' },
    { date: new Date(year, 11, 26), name: "St. Stephen's Day", nameDE: '2. Weihnachtstag' },
  ];
}

/**
 * Get holidays within a date range (inclusive).
 * Checks both current year and next year to handle year boundaries.
 */
export function getHolidaysInRange(from: Date, to: Date): PublicHoliday[] {
  const years = Array.from(new Set([from.getFullYear(), to.getFullYear()]));
  const allHolidays: PublicHoliday[] = [];
  for (const y of years) {
    allHolidays.push(...getBerlinHolidays(y));
  }

  const fromTime = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toTime = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();

  return allHolidays
    .filter(h => {
      const t = new Date(h.date.getFullYear(), h.date.getMonth(), h.date.getDate()).getTime();
      return t >= fromTime && t <= toTime;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Check if a specific date is a public holiday in Berlin.
 */
export function isHoliday(date: Date): PublicHoliday | null {
  const holidays = getBerlinHolidays(date.getFullYear());
  return holidays.find(h =>
    h.date.getFullYear() === date.getFullYear() &&
    h.date.getMonth() === date.getMonth() &&
    h.date.getDate() === date.getDate()
  ) || null;
}

/**
 * Check if a date is a weekend (Saturday or Sunday).
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a non-working day (weekend or public holiday).
 */
export function isNonWorkingDay(date: Date): boolean {
  return isWeekend(date) || isHoliday(date) !== null;
}
