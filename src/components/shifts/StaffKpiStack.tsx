'use client';

import React, { useCallback, useState } from 'react';
import { usePoll } from '@/lib/use-poll';
import {
  KpiCard,
  Ring,
  hoursLabel,
  usageTone,
  type RingTone,
} from '@/components/shifts/KpiParts';

/**
 * Staff self-service KPI stack for the Planning dashboard.
 *
 * Answers the three things staff open the app for, in order:
 *   1. When do I work next?              → hero next-shift card
 *   2. How are my hours tracking?        → this-week ring (vs contracted target
 *                                          or weekly cap) + this-month bar
 *                                          (€-to-cap for Minijob, hours-to-target
 *                                          for a fixed contract)
 *   3. Quick self-service                → open shifts to claim · my requests ·
 *                                          my on-time record
 *
 * Data: GET /api/shifts/me (own data only). Refreshes gently every 60s.
 */

interface MeData {
  employmentType: 'minijob' | 'midijob' | 'fulltime' | null;
  hourlyRate: number;
  hasContract: boolean;
  nextShift: {
    day: string;
    timeRange: string;
    roleName: string;
    when: 'today' | 'tomorrow' | 'later';
  } | null;
  moreThisWeek: number;
  weekly: { hours: number; limit: number | null; kind: 'target' | 'cap' | 'none' };
  monthly: {
    hours: number;
    eurUsed: number;
    eurLimit: number | null;
    hoursLimit: number | null;
    kind: 'cap' | 'target' | 'none';
    estEarnings: number;
  };
  openEligible: number;
  requests: { pending: number; awaitingTeammate: number; awaitingManager: number };
  punctuality: { matched: number; lateCount: number; earlyCount: number; onTimePct: number | null } | null;
}

function eur(n: number): string {
  return `€${n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// --- Horizontal progress bar -------------------------------------------------

function Bar({ pct, tone }: { pct: number; tone: RingTone }) {
  const color =
    tone === 'red'
      ? 'bg-red-500'
      : tone === 'amber'
        ? 'bg-amber-500'
        : tone === 'gray'
          ? 'bg-gray-300'
          : 'bg-green-500';
  return (
    <div className="w-full h-2.5 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%` }} />
    </div>
  );
}

export default function StaffKpiStack({
  companyId,
  onNavigate,
}: {
  companyId: number;
  onNavigate: (key: string) => void;
}) {
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/shifts/me?company_id=${companyId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as MeData);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
  usePoll(load, 60000);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 flex justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    // Fail quiet — the tiles below still work; don't block the dashboard.
    return null;
  }

  const { weekly, monthly } = data;

  // Week ring: contracted target fills green; a cap warns amber/red near/over it.
  const weekPct = weekly.limit ? weekly.hours / weekly.limit : 0;
  const weekTone: RingTone =
    weekly.kind === 'none'
      ? 'gray'
      : weekly.kind === 'target'
        ? 'green'
        : usageTone(weekly.hours, weekly.limit);
  const weekSub =
    weekly.kind === 'target'
      ? 'contracted'
      : weekly.kind === 'cap'
        ? 'weekly cap'
        : 'scheduled';

  // Month bar: Minijob shows € vs €603; fixed shows hours vs monthly target.
  const monthIsEur = monthly.kind === 'cap' && monthly.eurLimit !== null;
  const monthPct = monthIsEur
    ? monthly.eurLimit
      ? monthly.eurUsed / monthly.eurLimit
      : 0
    : monthly.hoursLimit
      ? monthly.hours / monthly.hoursLimit
      : 0;
  const monthTone: RingTone = monthIsEur
    ? usageTone(monthly.eurUsed, monthly.eurLimit)
    : monthly.kind === 'target'
      ? 'green'
      : 'gray';
  const roomHours =
    monthIsEur && monthly.eurLimit !== null && data.hourlyRate > 0
      ? Math.max(0, (monthly.eurLimit - monthly.eurUsed) / data.hourlyRate)
      : null;

  const ns = data.nextShift;
  const whenLabel = ns ? (ns.when === 'today' ? 'Today' : ns.when === 'tomorrow' ? 'Tomorrow' : ns.day) : '';

  return (
    <div className="flex flex-col gap-3">
      {/* Hero — next shift */}
      <KpiCard onClick={() => onNavigate('mine')} ariaLabel="My shifts" className="p-4">
        {ns ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-green-700">
                {ns.when === 'later' ? 'Next shift' : `Next shift · ${whenLabel}`}
              </span>
              {data.moreThisWeek > 0 && (
                <span className="text-[var(--fs-xs)] font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1 flex-shrink-0">
                  +{data.moreThisWeek} more this week
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
              {ns.when === 'later' && (
                <span className="text-[var(--fs-lg)] font-bold text-gray-900">{whenLabel}</span>
              )}
              <span className="text-[var(--fs-xxl)] font-extrabold text-gray-900 tabular-nums">
                {ns.timeRange}
              </span>
            </div>
            <div className="mt-0.5 text-[var(--fs-sm)] text-gray-500">
              {ns.roleName || 'Shift'}
              {ns.when !== 'later' && <span className="text-gray-400"> · {ns.day}</span>}
            </div>
          </>
        ) : (
          <>
            <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
              Next shift
            </span>
            <div className="mt-1 text-[var(--fs-md)] font-semibold text-gray-700">
              No upcoming shifts
            </div>
            <div className="text-[var(--fs-sm)] text-gray-400 mt-0.5">
              Check open shifts to pick one up.
            </div>
          </>
        )}
      </KpiCard>

      {/* Hours: week ring + month bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* This week */}
        <KpiCard onClick={() => onNavigate('hours')} ariaLabel="My hours" className="p-4">
          <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
            This week
          </span>
          <div className="mt-2 flex items-center gap-3.5">
            <Ring pct={weekPct} tone={weekTone} size={84} stroke={8}>
              <span className="text-[var(--fs-md)] font-extrabold text-gray-900 tabular-nums leading-none">
                {hoursLabel(weekly.hours)}
              </span>
              {weekly.limit !== null && (
                <span className="text-[var(--fs-xs)] text-gray-400 tabular-nums mt-0.5">
                  / {hoursLabel(weekly.limit)}
                </span>
              )}
            </Ring>
            <div className="min-w-0">
              <div className="text-[var(--fs-sm)] font-semibold text-gray-800">
                {weekly.limit !== null
                  ? weekly.kind === 'target'
                    ? weekly.hours >= weekly.limit
                      ? 'Target reached'
                      : `${hoursLabel(Math.max(0, weekly.limit - weekly.hours))} to go`
                    : weekly.hours > weekly.limit
                      ? `${hoursLabel(weekly.hours - weekly.limit)} over cap`
                      : `${hoursLabel(Math.max(0, weekly.limit - weekly.hours))} left`
                  : 'Scheduled'}
              </div>
              {weekly.limit !== null && (
                <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{weekSub}</div>
              )}
            </div>
          </div>
        </KpiCard>

        {/* This month */}
        <KpiCard onClick={() => onNavigate('hours')} ariaLabel="My hours this month" className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
              This month
            </span>
            <span className="text-[var(--fs-xs)] text-gray-400 tabular-nums">
              {hoursLabel(monthly.hours)}
            </span>
          </div>
          {monthIsEur ? (
            <>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[var(--fs-xl)] font-extrabold text-gray-900 tabular-nums">
                  {eur(monthly.eurUsed)}
                </span>
                <span className="text-[var(--fs-sm)] text-gray-400 tabular-nums">
                  / {eur(monthly.eurLimit ?? 0)}
                </span>
              </div>
              <div className="mt-2">
                <Bar pct={monthPct} tone={monthTone} />
              </div>
              <div className="mt-1.5 text-[var(--fs-xs)] text-gray-500">
                {monthly.eurUsed > (monthly.eurLimit ?? 0)
                  ? 'Over the €-Minijob cap'
                  : roomHours !== null
                    ? `≈ ${hoursLabel(roomHours)} room left to the cap`
                    : 'Minijob earnings cap'}
              </div>
            </>
          ) : monthly.kind === 'target' && monthly.hoursLimit ? (
            <>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-[var(--fs-xl)] font-extrabold text-gray-900 tabular-nums">
                  {hoursLabel(monthly.hours)}
                </span>
                <span className="text-[var(--fs-sm)] text-gray-400 tabular-nums">
                  / {hoursLabel(monthly.hoursLimit)}
                </span>
              </div>
              <div className="mt-2">
                <Bar pct={monthPct} tone={monthTone} />
              </div>
              <div className="mt-1.5 text-[var(--fs-xs)] text-gray-500">
                ≈ {eur(monthly.estEarnings)} · est. pay
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 text-[var(--fs-xl)] font-extrabold text-gray-900 tabular-nums">
                {hoursLabel(monthly.hours)}
              </div>
              <div className="mt-1 text-[var(--fs-xs)] text-gray-500">
                ≈ {eur(monthly.estEarnings)} · est. pay this month
              </div>
            </>
          )}
        </KpiCard>
      </div>

      {/* Quick self-service row */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard onClick={() => onNavigate('open')} ariaLabel="Open shifts to claim" className="p-3 text-center">
          <div className="text-[var(--fs-xxl)] font-extrabold tabular-nums text-green-700">
            {data.openEligible}
          </div>
          <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mt-0.5 leading-tight">
            Open to grab
          </div>
        </KpiCard>
        <KpiCard onClick={() => onNavigate('requests')} ariaLabel="My requests" className="p-3 text-center">
          <div
            className={`text-[var(--fs-xxl)] font-extrabold tabular-nums ${
              data.requests.pending > 0 ? 'text-amber-700' : 'text-gray-900'
            }`}
          >
            {data.requests.pending}
          </div>
          <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mt-0.5 leading-tight">
            My requests
          </div>
        </KpiCard>
        <KpiCard onClick={() => onNavigate('mine')} ariaLabel="My punctuality" className="p-3 text-center">
          <div className="text-[var(--fs-xxl)] font-extrabold tabular-nums text-gray-900">
            {data.punctuality && data.punctuality.onTimePct !== null
              ? `${data.punctuality.onTimePct}%`
              : '—'}
          </div>
          <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mt-0.5 leading-tight">
            On time
          </div>
        </KpiCard>
      </div>
    </div>
  );
}
