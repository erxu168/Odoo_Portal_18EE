'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { EmptyState, Spinner } from '@/components/shifts/ui';

/**
 * Busy times — a weekday × time-of-day heatmap of POS order volume, with a
 * "Staff needed" view that turns each slot's average volume into a suggested
 * headcount (suggestions only — the manager always sets the real count). The
 * orders-per-person ratio is a per-company dial the manager tunes here.
 */

interface BusyData {
  weeks: number;
  startDate: string;
  endDate: string;
  totalOrders: number;
  maxCell: number;
  activeBuckets: number[];
  grid: number[][]; // total orders [dow 0..6 Mon..Sun][bucket 0..11]
  avgGrid: number[][]; // avg orders per occurrence of that weekday-slot
  busiest: { dow: number; bucket: number; count: number } | null;
  ordersPerPerson: number;
  minStaff: number;
}

interface BusyTimesProps {
  companyId: number | null;
  isManager?: boolean;
  employeeId?: number | null;
  onBack: () => void;
  onHome: () => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEK_OPTIONS = [4, 12, 26];

function bucketLabel(b: number): string {
  const h = b * 2;
  const ap = h < 12 || h === 24 ? 'a' : 'p';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${ap}`;
}

export default function BusyTimes({ companyId, onBack }: BusyTimesProps) {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState<BusyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'orders' | 'staff'>('orders');
  const [ordersPerPerson, setOrdersPerPerson] = useState(8);
  const [minStaff, setMinStaff] = useState(1);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/busy?company_id=${companyId}&weeks=${weeks}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
      setOrdersPerPerson(typeof d.ordersPerPerson === 'number' ? d.ordersPerPerson : 8);
      setMinStaff(typeof d.minStaff === 'number' ? d.minStaff : 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [companyId, weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRatio = useCallback(
    (opp: number, min: number) => {
      if (!companyId) return;
      fetch('/api/shifts/busy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ordersPerPerson: opp, minStaff: min }),
      })
        .then(() => {
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1200);
        })
        .catch(() => {});
    },
    [companyId],
  );

  function bumpRatio(delta: number) {
    const next = Math.max(1, Math.min(100, ordersPerPerson + delta));
    setOrdersPerPerson(next);
    saveRatio(next, minStaff);
  }

  const suggested = useCallback(
    (avg: number): number => (avg > 0 ? Math.max(minStaff, Math.ceil(avg / ordersPerPerson)) : 0),
    [minStaff, ordersPerPerson],
  );

  const showStaff = mode === 'staff';
  const maxSuggested =
    data && showStaff
      ? Math.max(1, ...data.avgGrid.flat().map(a => suggested(a)))
      : data?.maxCell ?? 1;

  function cellValue(di: number, b: number): number {
    if (!data) return 0;
    return showStaff ? suggested(data.avgGrid[di][b]) : data.grid[di][b];
  }
  function cellStyle(v: number): React.CSSProperties {
    if (v === 0) return { backgroundColor: 'rgba(16,24,40,0.03)' };
    const intensity = maxSuggested > 0 ? v / maxSuggested : 0;
    return { backgroundColor: `rgba(22,163,74,${0.15 + intensity * 0.72})` };
  }
  function cellText(v: number): string {
    const intensity = maxSuggested > 0 ? v / maxSuggested : 0;
    return v === 0 ? 'text-gray-300' : intensity > 0.5 ? 'text-white' : 'text-gray-800';
  }

  const thin = data && data.totalOrders < 200;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Busy times" showBack onBack={onBack} />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <div className="pb-28 max-w-xl mx-auto w-full px-4 pt-4">
          <div className="flex gap-2 mb-3">
            {WEEK_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`px-3 py-2 rounded-lg text-[var(--fs-sm)] font-semibold border ${
                  weeks === w ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                }`}
              >
                {w}w
              </button>
            ))}
          </div>

          {/* View toggle: order volume vs suggested staff */}
          <div className="flex gap-2 mb-3 bg-gray-100 rounded-xl p-1">
            {(['orders', 'staff'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold ${
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                {m === 'orders' ? 'Order volume' : 'Staff needed'}
              </button>
            ))}
          </div>

          {loading ? (
            <Spinner />
          ) : !data || data.totalOrders === 0 ? (
            <EmptyState icon="🧾" title="No sales yet" body="Once the till has orders, your busy times will show up here." />
          ) : (
            <>
              <p className="text-[var(--fs-sm)] text-gray-500 mb-1">
                Based on <b className="text-gray-800">{data.totalOrders}</b> orders over the last {data.weeks} weeks.
              </p>
              {data.busiest && mode === 'orders' && (
                <p className="text-[var(--fs-sm)] text-gray-700 mb-3">
                  Busiest: <b>{WEEKDAYS_FULL[data.busiest.dow - 1]}</b> around <b>{bucketLabel(data.busiest.bucket)}–{bucketLabel(data.busiest.bucket + 1)}</b>.
                </p>
              )}

              {/* Staffing dial — only relevant in the "staff needed" view */}
              {showStaff && (
                <div className="mb-3 bg-white rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-sm)] font-bold text-gray-900">Orders one person can handle / 2h</div>
                      <div className="text-[var(--fs-xs)] text-gray-500">Higher = fewer staff suggested. Tune it to your service.</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => bumpRatio(-1)} className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 text-[18px] font-bold active:bg-gray-200">-</button>
                      <div className="w-9 text-center text-[var(--fs-md)] font-extrabold text-gray-900 tabular-nums">{ordersPerPerson}</div>
                      <button onClick={() => bumpRatio(1)} className="w-9 h-9 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 text-[18px] font-bold active:bg-gray-200">+</button>
                    </div>
                  </div>
                  {savedFlash && <div className="text-[var(--fs-xs)] text-green-600 font-semibold mt-1.5">Saved</div>}
                </div>
              )}

              {thin && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[var(--fs-sm)] text-amber-800">
                  Still learning your patterns — treat these as a rough guide until more sales build up.
                </div>
              )}

              <div className="overflow-x-auto -mx-1 px-1">
                <table className="border-separate" style={{ borderSpacing: '3px' }}>
                  <thead>
                    <tr>
                      <th />
                      {data.activeBuckets.map(b => (
                        <th key={b} className="text-[var(--fs-xs)] font-semibold text-gray-400 pb-1 min-w-[2.1rem]">
                          {bucketLabel(b)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAYS.map((wd, di) => (
                      <tr key={wd}>
                        <td className="text-[var(--fs-xs)] font-bold text-gray-500 pr-2 text-right">{wd}</td>
                        {data.activeBuckets.map(b => {
                          const v = cellValue(di, b);
                          const avg = data.avgGrid[di][b];
                          return (
                            <td key={b}>
                              <div
                                className={`w-[2.1rem] h-9 rounded-md flex items-center justify-center text-[var(--fs-xs)] font-bold tabular-nums ${cellText(v)}`}
                                style={cellStyle(v)}
                                title={
                                  showStaff
                                    ? `${WEEKDAYS_FULL[di]} ${bucketLabel(b)}: ~${avg} orders → ${v} ${v === 1 ? 'person' : 'people'}`
                                    : `${WEEKDAYS_FULL[di]} ${bucketLabel(b)}: ${data.grid[di][b]} orders`
                                }
                              >
                                {v > 0 ? v : ''}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[var(--fs-xs)] text-gray-400 mt-3 leading-snug">
                {showStaff
                  ? 'Suggested people per 2-hour slot — a starting point, not a rule. You always set the real number when you build the schedule.'
                  : 'Darker green = busier. Switch to “Staff needed” to turn this into suggested headcount.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
