'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { EmptyState, SectionTitle, Spinner, WeekNav } from '@/components/shifts/ui';
import { currentWeekKey, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * Team hours & fairness — manager oversight. Per person: hours this week vs
 * their contract, this month vs the monthly cap, and how many weekend shifts
 * they've worked over the last 8 weeks (so no one keeps carrying the weekends).
 */

interface OverviewEmp {
  id: number;
  name: string;
  weekHours: number;
  weeklyTarget: number | null;
  monthHours: number;
  cap: number | null;
  employmentType: 'minijob' | 'midijob' | 'fulltime' | null;
  hourlyRate: number;
  weekendWorked: number;
}
interface OverviewData {
  weekKey: string;
  weekendWindowWeeks: number;
  monthLabel: string;
  weekendAvg: number;
  employees: OverviewEmp[];
}

interface ManagerOverviewProps {
  companyId: number | null;
  isManager?: boolean;
  employeeId?: number | null;
  onBack: () => void;
  onHome: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(d: string): string {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}
function weekLabel(weekKey: string): string {
  const d = weekKeyDays(weekKey);
  return `${shortDate(d[0])} – ${shortDate(d[6])}`;
}
function fmtH(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

/** A "X / limit h" pill: amber over, green on-target, grey under / no limit. */
function HoursPill({ hours, limit, label }: { hours: number; limit: number | null; label: string }) {
  let tone = 'text-gray-500';
  let note = 'no limit';
  if (limit !== null) {
    if (hours > limit + 1e-9) {
      tone = 'text-amber-700';
      note = `▲ ${fmtH(Math.round((hours - limit) * 10) / 10)} over`;
    } else if (hours >= limit - 1e-9) {
      tone = 'text-green-700';
      note = 'on target';
    } else {
      tone = 'text-gray-500';
      note = `${fmtH(Math.round((limit - hours) * 10) / 10)} left`;
    }
  }
  return (
    <div className="flex-1 text-center">
      <div className="text-[var(--fs-xs)] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-[var(--fs-md)] font-bold tabular-nums ${tone}`}>
        {fmtH(hours)}
        {limit !== null && <span className="text-gray-400 font-semibold"> / {fmtH(limit)}h</span>}
      </div>
      <div className={`text-[var(--fs-xs)] ${tone}`}>{note}</div>
    </div>
  );
}

export default function ManagerOverview({ companyId, onBack }: ManagerOverviewProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/overview?company_id=${companyId}&week=${weekKey}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const emps = data?.employees ?? [];
  // Hours: most-over first (by whichever of week/month is furthest over their limit).
  const byHours = [...emps].sort((a, b) => {
    const over = (e: OverviewEmp) =>
      Math.max(e.weeklyTarget !== null ? e.weekHours - e.weeklyTarget : -999, e.cap !== null ? e.monthHours - e.cap : -999);
    return over(b) - over(a);
  });
  // Fairness: fewest weekend shifts first (who to nudge onto the weekend next).
  const byWeekend = [...emps].sort((a, b) => a.weekendWorked - b.weekendWorked);
  const maxWeekend = Math.max(1, ...emps.map(e => e.weekendWorked));

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Team hours & fairness" showBack onBack={onBack} />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <div className="pb-28 max-w-xl mx-auto w-full">
          <div className="pt-3">
            <WeekNav
              weekKey={weekKey}
              label={weekLabel(weekKey)}
              onPrev={() => setWeekKey(offsetWeekKey(weekKey, -1))}
              onNext={() => setWeekKey(offsetWeekKey(weekKey, 1))}
            />
          </div>

          {loading ? (
            <Spinner />
          ) : emps.length === 0 ? (
            <EmptyState icon="👥" title="No schedulable staff" body="Add staff with a role in the Roster to see their hours here." />
          ) : (
            <>
              <SectionTitle>Hours · this week & {data?.monthLabel}</SectionTitle>
              <div className="px-4 flex flex-col gap-2">
                {byHours.map(e => (
                  <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-3">
                    <div className="text-[var(--fs-md)] font-bold text-gray-900 mb-2">
                      {e.name}
                      {e.employmentType === 'minijob' && (
                        <span className="ml-2 text-[var(--fs-xs)] font-semibold text-gray-400 uppercase">mini-job</span>
                      )}
                    </div>
                    <div className="flex items-stretch gap-2">
                      <HoursPill hours={e.weekHours} limit={e.weeklyTarget} label="This week" />
                      <div className="w-px bg-gray-100" />
                      <HoursPill hours={e.monthHours} limit={e.cap} label="This month" />
                    </div>
                  </div>
                ))}
              </div>

              <SectionTitle>Weekend fairness · last {data?.weekendWindowWeeks} weeks</SectionTitle>
              <p className="px-5 text-[var(--fs-sm)] text-gray-500 -mt-1 mb-2">
                Weekend shifts worked. Team average: <b>{data?.weekendAvg}</b>. Fewest first — nudge them onto the next weekend.
              </p>
              <div className="px-4 flex flex-col gap-2">
                {byWeekend.map(e => {
                  const above = data && e.weekendWorked > data.weekendAvg + 1e-9;
                  const below = data && e.weekendWorked < data.weekendAvg - 1e-9;
                  return (
                    <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{e.name}</div>
                        <div className="h-2 mt-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${above ? 'bg-amber-400' : 'bg-green-500'}`}
                            style={{ width: `${Math.round((e.weekendWorked / maxWeekend) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[var(--fs-lg)] font-extrabold text-gray-900 tabular-nums">{e.weekendWorked}</div>
                        <div className={`text-[var(--fs-xs)] font-semibold ${above ? 'text-amber-600' : below ? 'text-gray-400' : 'text-gray-500'}`}>
                          {above ? 'carrying more' : below ? 'below average' : 'on par'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
