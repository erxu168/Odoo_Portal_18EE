'use client';

import React, { useMemo } from 'react';
import { getHolidaysInRange, isHoliday, isWeekend } from '@/lib/german-holidays';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SupplierInfo {
  id: number;
  name: string;
  order_days: string;      // JSON array e.g. '["mon","thu"]'
  delivery_days?: string;  // JSON array e.g. '["wed","thu"]' — days they deliver
  lead_time_days: number;
}

interface PurchaseAlertsProps {
  suppliers: SupplierInfo[];
}

interface HolidayAlert {
  type: 'holiday';
  date: Date;
  name: string;
  nameDE: string;
  daysUntil: number;
  dayOfWeek: string;
}

interface SupplierDeadlineAlert {
  type: 'deadline';
  supplier: string;
  orderByDate: Date;
  orderByDay: string;
  deliveryInfo: string;
  daysUntil: number;
  isUrgent: boolean; // today or tomorrow
}

type Alert = HolidayAlert | SupplierDeadlineAlert;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};
const DAY_LABELS_SHORT: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed',
  thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

function parseDays(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map((d: string) => d.toLowerCase().slice(0, 3)) : [];
  } catch { return []; }
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Find the next occurrence of a given weekday from a start date (inclusive).
 */
function nextWeekday(from: Date, dayName: string): Date {
  const targetIdx = DAY_NAMES.indexOf(dayName);
  if (targetIdx < 0) return from;
  const current = from.getDay();
  let diff = targetIdx - current;
  if (diff < 0) diff += 7;
  return addDays(from, diff);
}

/**
 * Find all next occurrences of given weekdays within N days from today.
 */
function nextOccurrences(dayNames: string[], withinDays: number): Date[] {
  const today = todayLocal();
  const results: Date[] = [];
  for (const dayName of dayNames) {
    let d = nextWeekday(today, dayName);
    while (daysBetween(today, d) <= withinDays) {
      results.push(d);
      d = addDays(d, 7);
    }
  }
  return results.sort((a, b) => a.getTime() - b.getTime());
}

// ─────────────────────────────────────────────
// Alert computation
// ─────────────────────────────────────────────

function computeAlerts(suppliers: SupplierInfo[]): Alert[] {
  const today = todayLocal();
  const windowEnd = addDays(today, 7);
  const alerts: Alert[] = [];

  // 1. Public holiday alerts
  const holidays = getHolidaysInRange(today, windowEnd);
  for (const h of holidays) {
    const du = daysBetween(today, h.date);
    alerts.push({
      type: 'holiday',
      date: h.date,
      name: h.name,
      nameDE: h.nameDE,
      daysUntil: du,
      dayOfWeek: DAY_LABELS[DAY_NAMES[h.date.getDay()]] || '',
    });
  }

  // 2. Supplier ordering deadline alerts
  // Only for suppliers with lead_time > 1 or delivery_days configured
  for (const sup of suppliers) {
    const orderDays = parseDays(sup.order_days);
    const deliveryDays = parseDays(sup.delivery_days);
    if (orderDays.length === 0) continue;
    // Only show deadline alerts for suppliers that need advance ordering
    if (sup.lead_time_days <= 1 && deliveryDays.length === 0) continue;

    // Find next order-by dates — only show the SOONEST one per supplier
    const upcomingOrderDates = nextOccurrences(orderDays, 7);
    if (upcomingOrderDates.length === 0) continue;
    const orderDate = upcomingOrderDates[0];
    const du = daysBetween(today, orderDate);

    // Calculate delivery info
    let deliveryInfo = '';
    if (deliveryDays.length > 0) {
      // Fixed delivery days — find the next delivery day after the order date + lead_time
      const earliestDelivery = addDays(orderDate, sup.lead_time_days || 1);
      const deliveryOccurrences = nextOccurrences(deliveryDays, 14)
        .filter(d => d.getTime() >= earliestDelivery.getTime());
      if (deliveryOccurrences.length > 0) {
        const nextDelivery = deliveryOccurrences[0];
        const deliveryHoliday = isHoliday(nextDelivery);
        if (deliveryHoliday) {
          deliveryInfo = `Delivery ${formatDate(nextDelivery)} (${deliveryHoliday.nameDE} - no delivery!)`;
        } else {
          deliveryInfo = `Delivery ${formatDate(nextDelivery)}`;
        }
      } else {
        deliveryInfo = `Delivery days: ${deliveryDays.map(d => DAY_LABELS_SHORT[d] || d).join('/')}`;
      }
    } else if (sup.lead_time_days > 1) {
      const estDelivery = addDays(orderDate, sup.lead_time_days);
      let deliveryDate = estDelivery;
      while (isWeekend(deliveryDate)) {
        deliveryDate = addDays(deliveryDate, 1);
      }
      const deliveryHoliday = isHoliday(deliveryDate);
      if (deliveryHoliday) {
        deliveryInfo = `Est. delivery ${formatDate(deliveryDate)} (${deliveryHoliday.nameDE} - may be delayed)`;
      } else {
        deliveryInfo = `Est. delivery ${formatDate(deliveryDate)}`;
      }
    }

    alerts.push({
      type: 'deadline',
      supplier: sup.name,
      orderByDate: orderDate,
      orderByDay: DAY_LABELS[DAY_NAMES[orderDate.getDay()]] || '',
      deliveryInfo,
      daysUntil: du,
      isUrgent: du <= 1,
    });
  }

  // Sort: holidays first, then by days until
  return alerts.sort((a, b) => {
    if (a.type === 'holiday' && b.type !== 'holiday') return -1;
    if (a.type !== 'holiday' && b.type === 'holiday') return 1;
    return a.daysUntil - b.daysUntil;
  });
}

// ─────────────────────────────────────────────
// Urgency label
// ─────────────────────────────────────────────

function urgencyLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${daysUntil} days`;
}

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

const HolidayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="10" y1="14" x2="14" y2="14" />
  </svg>
);

const TruckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function PurchaseAlerts({ suppliers }: PurchaseAlertsProps) {
  const alerts = useMemo(() => computeAlerts(suppliers), [suppliers]);

  if (alerts.length === 0) return null;

  return (
    <div className="px-4 pt-3 pb-1">
      {alerts.map((alert, idx) => {
        if (alert.type === 'holiday') {
          const isSoon = alert.daysUntil <= 2;
          return (
            <div
              key={`h-${idx}`}
              className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl border mb-2 ${
                isSoon
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className={`mt-0.5 flex-shrink-0 ${isSoon ? 'text-red-500' : 'text-amber-500'}`}>
                <HolidayIcon />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[var(--fs-sm)] font-bold ${isSoon ? 'text-red-800' : 'text-amber-800'}`}>
                    {alert.nameDE}
                  </span>
                  <span className={`text-[var(--fs-xs)] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                    isSoon ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                  }`}>
                    {urgencyLabel(alert.daysUntil)}
                  </span>
                </div>
                <p className={`text-[var(--fs-xs)] mt-0.5 ${isSoon ? 'text-red-700' : 'text-amber-700'}`}>
                  {alert.dayOfWeek}, {formatDateShort(alert.date)} &mdash; No deliveries. Order early!
                </p>
              </div>
            </div>
          );
        }

        // Supplier deadline alert
        const dl = alert as SupplierDeadlineAlert;
        return (
          <div
            key={`d-${idx}`}
            className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl border mb-2 ${
              dl.isUrgent
                ? 'bg-blue-50 border-blue-300'
                : 'bg-blue-50/60 border-blue-200'
            }`}
          >
            <div className={`mt-0.5 flex-shrink-0 ${dl.isUrgent ? 'text-blue-600' : 'text-blue-400'}`}>
              <TruckIcon />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[var(--fs-sm)] font-bold ${dl.isUrgent ? 'text-blue-900' : 'text-blue-800'}`}>
                  {dl.supplier}
                </span>
                <span className={`text-[var(--fs-xs)] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                  dl.isUrgent ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-700'
                }`}>
                  {urgencyLabel(dl.daysUntil)}
                </span>
              </div>
              <p className="text-[var(--fs-xs)] text-blue-700 mt-0.5">
                Order by <strong>{formatDate(dl.orderByDate)}</strong>
              </p>
              {dl.deliveryInfo && (
                <p className="text-[var(--fs-xs)] text-blue-600 mt-0.5">
                  {dl.deliveryInfo}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
