'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { EmptyState, Spinner } from '@/components/shifts/ui';

/**
 * Busy times — a weekday × time-of-day heatmap of POS order volume, so managers
 * can see when they're actually busy. The honest first step of demand-based
 * staffing: works with whatever sales history exists.
 */

interface BusyData {
  weeks: number;
  startDate: string;
  endDate: string;
  totalOrders: number;
  maxCell: number;
  activeBuckets: number[];
  grid: number[][]; // [dow 0..6 Mon..Sun][bucket 0..11]
  busiest: { dow: number; bucket: number; count: number } | null;
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

/** Bucket b covers hours [b*2, b*2+2). Label the start in am/pm, e.g. "10a", "8p". */
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

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/busy?company_id=${companyId}&weeks=${weeks}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [companyId, weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  function cellStyle(count: number, maxCell: number): React.CSSProperties {
    if (count === 0) return { backgroundColor: 'rgba(16,24,40,0.03)' };
    const intensity = maxCell > 0 ? count / maxCell : 0;
    return { backgroundColor: `rgba(22,163,74,${0.15 + intensity * 0.72})` };
  }
  function cellText(count: number, maxCell: number): string {
    const intensity = maxCell > 0 ? count / maxCell : 0;
    return count === 0 ? 'text-gray-300' : intensity > 0.5 ? 'text-white' : 'text-gray-800';
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
          {/* range selector */}
          <div className="flex gap-2 mb-3">
            {WEEK_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={`px-3.5 py-2 rounded-lg text-[var(--fs-sm)] font-semibold border ${
                  weeks === w ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                }`}
              >
                Last {w} weeks
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
              {data.busiest && (
                <p className="text-[var(--fs-sm)] text-gray-700 mb-3">
                  Busiest: <b>{WEEKDAYS_FULL[data.busiest.dow - 1]}</b> around <b>{bucketLabel(data.busiest.bucket)}–{bucketLabel(data.busiest.bucket + 1)}</b>.
                </p>
              )}
              {thin && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[var(--fs-sm)] text-amber-800">
                  Still learning your patterns — this becomes more reliable as more sales build up.
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
                          const c = data.grid[di][b];
                          return (
                            <td key={b}>
                              <div
                                className={`w-[2.1rem] h-9 rounded-md flex items-center justify-center text-[var(--fs-xs)] font-bold tabular-nums ${cellText(c, data.maxCell)}`}
                                style={cellStyle(c, data.maxCell)}
                                title={`${WEEKDAYS_FULL[di]} ${bucketLabel(b)}–${bucketLabel(b + 1)}: ${c} orders`}
                              >
                                {c > 0 ? c : ''}
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
                Darker green = busier. This is the first step toward staffing suggestions — soon it can recommend how many people to schedule per shift.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
