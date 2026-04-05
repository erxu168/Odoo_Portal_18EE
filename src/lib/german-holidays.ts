/**
 * German public holidays calculator — national + Berlin-specific.
 * Computes fixed and moveable (Easter-based) holidays for any year.
 *
 * Also contains supplier order deadline logic used by the purchase alerts system.
 */

// ─── Core types ───

export interface PublicHoliday {
  date: Date;
  name: string;
  nameDE: string;
}

/** String-keyed variant used by server-side purchase alerts API. */
export interface PublicHolidayStr {
  date: string;      // YYYY-MM-DD
  name: string;      // German name
  nameEn: string;    // English name
  dayOfWeek: string; // e.g. "Monday"
}

// ─── Date helpers ───

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ─── Easter calculation (Anonymous Gregorian algorithm) ───

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

// ─── Holiday lists ───

/**
 * Get all public holidays for Berlin for a given year.
 * Includes national German holidays + Berlin-specific
 * (Internationaler Frauentag, Reformationstag since 2019).
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
    { date: new Date(year, 9, 31), name: 'Reformation Day', nameDE: 'Reformationstag' }, // Berlin since 2019
    { date: new Date(year, 11, 25), name: 'Christmas Day', nameDE: '1. Weihnachtstag' },
    { date: new Date(year, 11, 26), name: "St. Stephen's Day", nameDE: '2. Weihnachtstag' },
  ];
}

/**
 * Get all public holidays for Berlin for a given year (string-keyed variant).
 * Used by the purchase alerts API.
 */
export function getBerlinHolidaysStr(year: number): PublicHolidayStr[] {
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return getBerlinHolidays(year).map(h => ({
    date: dateKey(h.date),
    name: h.nameDE,
    nameEn: h.name,
    dayOfWeek: DOW[h.date.getDay()],
  }));
}

// ─── Range / lookup queries ───

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

// ─── String-keyed utilities (used by purchase alerts API) ───

/**
 * Returns holidays within the next N days from a reference date (string-keyed).
 */
export function getUpcomingHolidays(refDate: Date, windowDays: number = 7): PublicHolidayStr[] {
  const year = refDate.getFullYear();
  const allHolidays = [...getBerlinHolidaysStr(year), ...getBerlinHolidaysStr(year + 1)];
  const refKey = dateKey(refDate);
  const endDate = addDays(refDate, windowDays);
  const endKey = dateKey(endDate);

  return allHolidays.filter(h => h.date >= refKey && h.date <= endKey);
}

/**
 * Build a Set of holiday date keys (YYYY-MM-DD) for quick lookup.
 */
export function getHolidaySet(year: number): Set<string> {
  return new Set(getBerlinHolidaysStr(year).map(h => h.date));
}

// ─── Supplier order deadline logic ───

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

export interface SupplierDeadlineAlert {
  supplierId: number;
  supplierName: string;
  nextDeliveryDate: string;       // YYYY-MM-DD
  nextDeliveryDay: string;        // e.g. "Wednesday"
  orderByDate: string;            // YYYY-MM-DD — latest date to place order
  orderByDay: string;             // e.g. "Thursday"
  daysUntilDeadline: number;      // negative = overdue/missed
  urgency: 'overdue' | 'today' | 'tomorrow' | 'soon' | 'ok';
  leadTimeDays: number;
  holidayImpact: string | null;   // warning if a holiday falls between order & delivery
}

/**
 * For a supplier with fixed delivery days and lead time, compute:
 * - The next delivery date (from today forward)
 * - The latest date to place the order (delivery - lead_time business days)
 * - Whether any holidays fall in between
 */
export function computeSupplierDeadline(
  supplierId: number,
  supplierName: string,
  deliveryDays: string[],   // e.g. ['wed', 'thu']
  orderDays: string[],      // e.g. ['thu'] — days when orders can be placed (cutoff)
  leadTimeDays: number,
  refDate: Date,
): SupplierDeadlineAlert | null {
  if (deliveryDays.length === 0) return null;

  const holidaySet = new Set([
    ...getBerlinHolidaysStr(refDate.getFullYear()).map(h => h.date),
    ...getBerlinHolidaysStr(refDate.getFullYear() + 1).map(h => h.date),
  ]);
  const allHolidays = [...getBerlinHolidaysStr(refDate.getFullYear()), ...getBerlinHolidaysStr(refDate.getFullYear() + 1)];

  // Find next delivery date (up to 14 days ahead)
  let nextDelivery: Date | null = null;
  for (let offset = 1; offset <= 14; offset++) {
    const candidate = addDays(refDate, offset);
    const dayName = DAY_NAMES[candidate.getDay()];
    const candidateKey = dateKey(candidate);
    // Delivery can't happen on a holiday
    if (deliveryDays.includes(dayName) && !holidaySet.has(candidateKey)) {
      nextDelivery = candidate;
      break;
    }
  }
  if (!nextDelivery) return null;

  // Calculate order-by date: go back lead_time_days business days from delivery
  // Business days = skip weekends and holidays
  let orderBy = new Date(nextDelivery);
  let businessDaysBack = 0;
  while (businessDaysBack < leadTimeDays) {
    orderBy = addDays(orderBy, -1);
    const dow = orderBy.getDay();
    const key = dateKey(orderBy);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(key)) {
      businessDaysBack++;
    }
  }

  // If orderDays is specified, snap order-by to the latest matching day on or before computed date
  if (orderDays.length > 0) {
    let snapped = new Date(orderBy);
    for (let i = 0; i < 7; i++) {
      const dayName = DAY_NAMES[snapped.getDay()];
      if (orderDays.includes(dayName)) break;
      snapped = addDays(snapped, -1);
    }
    orderBy = snapped;
  }

  const orderByKey = dateKey(orderBy);
  const diffMs = orderBy.getTime() - refDate.getTime();
  const daysUntilDeadline = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Check for holidays between order and delivery
  let holidayImpact: string | null = null;
  const impactHolidays = allHolidays.filter(h => h.date > orderByKey && h.date <= dateKey(nextDelivery!));
  if (impactHolidays.length > 0) {
    holidayImpact = impactHolidays.map(h => `${h.nameEn} (${h.dayOfWeek} ${h.date})`).join(', ');
  }

  let urgency: SupplierDeadlineAlert['urgency'];
  if (daysUntilDeadline < 0) urgency = 'overdue';
  else if (daysUntilDeadline === 0) urgency = 'today';
  else if (daysUntilDeadline === 1) urgency = 'tomorrow';
  else if (daysUntilDeadline <= 3) urgency = 'soon';
  else urgency = 'ok';

  return {
    supplierId,
    supplierName,
    nextDeliveryDate: dateKey(nextDelivery),
    nextDeliveryDay: DAY_LABELS[DAY_NAMES[nextDelivery.getDay()]] || '',
    orderByDate: orderByKey,
    orderByDay: DAY_LABELS[DAY_NAMES[orderBy.getDay()]] || '',
    daysUntilDeadline,
    urgency,
    leadTimeDays,
    holidayImpact,
  };
}
