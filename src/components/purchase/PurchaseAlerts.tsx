'use client';

import React, { useEffect, useState } from 'react';

// ─────────────────────────────────────────────
// PurchaseAlerts — Holiday warnings + supplier deadline alerts
// Renders on the purchase dashboard above the tile grid
// ─────────────────────────────────────────────

interface Holiday {
  date: string;
  name: string;
  nameEn: string;
  dayOfWeek: string;
}

interface Deadline {
  supplierId: number;
  supplierName: string;
  nextDeliveryDate: string;
  nextDeliveryDay: string;
  orderByDate: string;
  orderByDay: string;
  daysUntilDeadline: number;
  urgency: 'overdue' | 'today' | 'tomorrow' | 'soon' | 'ok';
  leadTimeDays: number;
  holidayImpact: string | null;
}

interface AlertsData {
  today: string;
  holidays: Holiday[];
  deadlines: Deadline[];
}

interface PurchaseAlertsProps {
  locationId: number;
}

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const TruckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

const AlertTriangle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function daysFromNow(dateStr: string, today: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

export default function PurchaseAlerts({ locationId }: PurchaseAlertsProps) {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/purchase/alerts?location_id=${locationId}&window=7`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [locationId]);

  if (loading) return null; // Don't show skeleton — just appear when ready
  if (!data) return null;

  const hasHolidays = data.holidays.length > 0;
  const urgentDeadlines = data.deadlines.filter(
    d => d.urgency === 'overdue' || d.urgency === 'today' || d.urgency === 'tomorrow' || d.urgency === 'soon'
  );
  const hasAlerts = hasHolidays || urgentDeadlines.length > 0;

  if (!hasAlerts) return null; // Nothing to show

  return (
    <div className="px-4 pt-3">
      {/* Section header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full mb-2"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-amber-500"><AlertTriangle /></span>
          <span className="text-[11px] font-bold tracking-wide uppercase text-amber-700">
            Order Alerts
          </span>
          <span className="text-[10px] font-mono text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">
            {data.holidays.length + urgentDeadlines.length}
          </span>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2"
          className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!collapsed && (
        <div className="space-y-2">
          {/* ── Holiday warnings ── */}
          {data.holidays.map((h) => {
            const daysAway = daysFromNow(h.date, data.today);
            const isImminent = daysAway <= 2;
            return (
              <div
                key={h.date}
                className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl border ${
                  isImminent
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <div className={`mt-0.5 flex-shrink-0 ${
                  isImminent ? 'text-red-500' : 'text-amber-500'
                }`}>
                  <CalendarIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-bold ${
                    isImminent ? 'text-red-800' : 'text-amber-800'
                  }`}>
                    {h.name}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${
                    isImminent ? 'text-red-600' : 'text-amber-600'
                  }`}>
                    {h.dayOfWeek}, {formatDateShort(h.date)}
                    {daysAway === 0 && ' — TODAY'}
                    {daysAway === 1 && ' — TOMORROW'}
                    {daysAway > 1 && ` — in ${daysAway} days`}
                  </div>
                  <div className={`text-[11px] mt-1 leading-relaxed ${
                    isImminent ? 'text-red-700' : 'text-amber-700'
                  }`}>
                    No deliveries on this day. Order early to avoid gaps!
                  </div>
                </div>
              </div>
            );
          })}

          {/* ── Supplier deadline alerts ── */}
          {urgentDeadlines.map((d) => {
            const isOverdue = d.urgency === 'overdue';
            const isToday = d.urgency === 'today';
            const isTomorrow = d.urgency === 'tomorrow';
            const isCritical = isOverdue || isToday;

            return (
              <div
                key={d.supplierId}
                className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl border ${
                  isCritical
                    ? 'bg-red-50 border-red-200'
                    : isTomorrow
                    ? 'bg-orange-50 border-orange-200'
                    : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className={`mt-0.5 flex-shrink-0 ${
                  isCritical ? 'text-red-500' : isTomorrow ? 'text-orange-500' : 'text-blue-500'
                }`}>
                  <TruckIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] font-bold ${
                      isCritical ? 'text-red-800' : isTomorrow ? 'text-orange-800' : 'text-blue-800'
                    }`}>
                      {d.supplierName}
                    </span>
                    {isCritical && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500 text-white uppercase">
                        {isOverdue ? 'Missed' : 'Order today!'}
                      </span>
                    )}
                    {isTomorrow && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white uppercase">
                        Tomorrow
                      </span>
                    )}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${
                    isCritical ? 'text-red-600' : isTomorrow ? 'text-orange-600' : 'text-blue-600'
                  }`}>
                    {isOverdue
                      ? `Deadline was ${d.orderByDay}, ${formatDateShort(d.orderByDate)}`
                      : `Order by ${d.orderByDay}, ${formatDateShort(d.orderByDate)}`
                    }
                    {' '}\u2192{' '}
                    Delivery: {d.nextDeliveryDay}, {formatDateShort(d.nextDeliveryDate)}
                  </div>
                  {d.holidayImpact && (
                    <div className={`text-[10px] mt-1 font-semibold ${
                      isCritical ? 'text-red-700' : 'text-orange-700'
                    }`}>
                      \u26A0 Holiday in window: {d.holidayImpact}
                    </div>
                  )}
                  <div className={`text-[10px] mt-0.5 ${
                    isCritical ? 'text-red-500' : isTomorrow ? 'text-orange-500' : 'text-blue-400'
                  }`}>
                    {d.leadTimeDays} business day{d.leadTimeDays !== 1 ? 's' : ''} lead time
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
