/**
 * German / Berlin public holiday computation + supplier order deadline logic.
 * Used by the purchase alerts system to warn staff about upcoming holidays
 * and supplier ordering deadlines.
 */

// ─── Easter calculation (Anonymous Gregorian algorithm) ───
function computeEasterSunday(year: number): Date {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

export interface PublicHoliday {
  date: string;      // YYYY-MM-DD
  name: string;      // German name
  nameEn: string;    // English name
  dayOfWeek: string; // e.g. "Monday"
}

/**
 * Returns all public holidays for Berlin for a given year.
 * Includes national + Berlin-specific holidays.
 */
export function getBerlinHolidays(year: number): PublicHoliday[] {
  const easter = computeEasterSunday(year);
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function holiday(date: Date, name: string, nameEn: string): PublicHoliday {
    return {
      date: dateKey(date),
      name,
      nameEn,
      dayOfWeek: DOW[date.getDay()],
    };
  }

  return [
    // Fixed national holidays
    holiday(new Date(year, 0, 1), 'Neujahr', 'New Year\'s Day'),
    // Berlin-specific
    holiday(new Date(year, 2, 8), 'Internationaler Frauentag', 'International Women\'s Day'),
    // Easter-based moveable holidays
    holiday(addDays(easter, -2), 'Karfreitag', 'Good Friday'),
    holiday(addDays(easter, 1), 'Ostermontag', 'Easter Monday'),
    // Fixed
    holiday(new Date(year, 4, 1), 'Tag der Arbeit', 'Labour Day'),
    // Easter-based
    holiday(addDays(easter, 39), 'Christi Himmelfahrt', 'Ascension Day'),
    holiday(addDays(easter, 50), 'Pfingstmontag', 'Whit Monday'),
    // Fixed national
    holiday(new Date(year, 9, 3), 'Tag der Deutschen Einheit', 'German Unity Day'),
    // Berlin-specific (since 2019)
    holiday(new Date(year, 9, 31), 'Reformationstag', 'Reformation Day'),
    // Christmas
    holiday(new Date(year, 11, 25), '1. Weihnachtstag', 'Christmas Day'),
    holiday(new Date(year, 11, 26), '2. Weihnachtstag', 'Boxing Day'),
  ];
}

/**
 * Returns holidays within the next N days from a reference date.
 */
export function getUpcomingHolidays(refDate: Date, windowDays: number = 7): PublicHoliday[] {
  const year = refDate.getFullYear();
  // Check current year and next year (for Dec→Jan edge case)
  const allHolidays = [...getBerlinHolidays(year), ...getBerlinHolidays(year + 1)];
  const refKey = dateKey(refDate);
  const endDate = addDays(refDate, windowDays);
  const endKey = dateKey(endDate);

  return allHolidays.filter(h => h.date >= refKey && h.date <= endKey);
}

/**
 * Build a Set of holiday date keys for quick lookup.
 */
export function getHolidaySet(year: number): Set<string> {
  const holidays = getBerlinHolidays(year);
  return new Set(holidays.map(h => h.date));
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
    ...getBerlinHolidays(refDate.getFullYear()).map(h => h.date),
    ...getBerlinHolidays(refDate.getFullYear() + 1).map(h => h.date),
  ]);
  const allHolidays = [...getBerlinHolidays(refDate.getFullYear()), ...getBerlinHolidays(refDate.getFullYear() + 1)];

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

  const refKey = dateKey(refDate);
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
