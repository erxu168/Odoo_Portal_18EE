'use client';

import React, { useCallback, useState } from 'react';
import { usePoll } from '@/lib/use-poll';
import PresenceCard from '@/components/shifts/PresenceCard';
import {
  KpiCard,
  CoverageStrip,
  FlagRow,
  hoursLabel,
  type CoverageDay,
} from '@/components/shifts/KpiParts';

/**
 * Manager operations KPI stack for the Planning dashboard.
 *
 * A scan-top-down ops board — now → today → week ahead:
 *   1. On shift now + late          → live PresenceCard (self-fetching)
 *   2. This week's coverage         → 7-day heat-strip + open shifts + ArbZG risk
 *   3. Team hours & cost            → per-person week hours vs cap/target, plus
 *                                      Minijob €-to-cap risk and est. labour cost
 *   4. Punctuality hot-spots        → who ran late/early most this week
 *
 * Data: GET /api/shifts/coverage, /api/shifts/team, /api/shifts/punctuality
 * (all current-week, manager-only). Refreshes gently every 60s.
 */

interface CoverageData {
  days: (CoverageDay & { cost: number })[];
  totals: { shifts: number; open: number; overCap: number; cost: number };
  warnings: { employee: string; kind: 'rest' | 'long'; detail: string }[];
}

interface TeamEmployee {
  employeeId: number;
  name: string;
  employmentType: 'minijob' | 'midijob' | 'fulltime' | null;
  weekHours: number;
  monthHours: number;
  weekLimit: number | null;
  weekKind: 'target' | 'cap' | 'none';
  monthEur: number;
  capEur: number | null;
  overCap: boolean;
  nearEurCap: boolean;
  overEurCap: boolean;
}
interface TeamData {
  totals: { people: number; weekHours: number; weekCost: number; overCap: number; atEurCap: number };
  employees: TeamEmployee[];
}

interface PunctEmployee {
  employeeName: string;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  overCount: number;
  overMins: number;
  matched: number;
}
interface PunctData {
  employees: PunctEmployee[];
  unmatched: number;
}

function eur(n: number): string {
  return `€${Math.round(n).toLocaleString('de-DE')}`;
}
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

const TEAM_ROWS = 4;

export default function ManagerKpiStack({
  companyId,
  onNavigate,
}: {
  companyId: number;
  onNavigate: (key: string) => void;
}) {
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [punct, setPunct] = useState<PunctData | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    const grab = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as T;
      } catch {
        return null;
      }
    };
    const [cov, tm, pu] = await Promise.all([
      grab<CoverageData>(`/api/shifts/coverage?company_id=${companyId}`),
      grab<TeamData>(`/api/shifts/team?company_id=${companyId}`),
      grab<PunctData>(`/api/shifts/punctuality?company_id=${companyId}`),
    ]);
    if (cov) setCoverage(cov);
    if (tm) setTeam(tm);
    if (pu) setPunct(pu);
  }, [companyId]);

  React.useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 60000);

  const offenders = (punct?.employees ?? [])
    .filter(e => e.lateMins + e.earlyMins > 0)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      {/* 1 — On shift now */}
      <PresenceCard companyId={companyId} onOpen={() => onNavigate('presence')} />

      {/* 2 — Coverage this week */}
      {coverage && (
        <KpiCard onClick={() => onNavigate('coverage')} ariaLabel="Coverage this week" className="p-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
              This week
            </span>
            <span className="text-[var(--fs-xs)] text-gray-400 tabular-nums">
              {coverage.totals.shifts} shifts · ≈ {eur(coverage.totals.cost)}
            </span>
          </div>
          <CoverageStrip days={coverage.days} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {coverage.totals.open > 0 ? (
              <span className="text-[var(--fs-sm)] font-semibold text-amber-700">
                {coverage.totals.open} open shift{coverage.totals.open === 1 ? '' : 's'} to fill
              </span>
            ) : (
              <span className="text-[var(--fs-sm)] font-semibold text-green-700">All shifts filled</span>
            )}
            {coverage.totals.overCap > 0 && (
              <span className="text-[var(--fs-sm)] font-semibold text-red-600">
                {coverage.totals.overCap} over cap
              </span>
            )}
            {coverage.warnings.length > 0 && (
              <span className="text-[var(--fs-sm)] font-semibold text-red-600">
                {coverage.warnings.length} rest/hours warning{coverage.warnings.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </KpiCard>
      )}

      {/* 3 — Team hours & cost */}
      {team && team.employees.length > 0 && (
        <KpiCard onClick={() => onNavigate('roster')} ariaLabel="Team hours" className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
              Team hours
            </span>
            <span className="text-[var(--fs-xs)] text-gray-400 tabular-nums">
              {team.totals.people} on rota · {hoursLabel(team.totals.weekHours)}
            </span>
          </div>
          <div className="divide-y divide-gray-100">
            {team.employees.slice(0, TEAM_ROWS).map(e => {
              const overEur = e.overEurCap;
              const nearEur = e.nearEurCap;
              const hoursTone = e.overCap
                ? 'text-red-600'
                : e.weekKind === 'target' && e.weekLimit && e.weekHours >= e.weekLimit
                  ? 'text-green-700'
                  : 'text-gray-900';
              return (
                <div key={e.employeeId} className="flex items-center gap-2 py-2">
                  <span className="text-[var(--fs-sm)] font-semibold text-gray-800 min-w-0 truncate flex-1">
                    {firstName(e.name)}
                  </span>
                  {e.capEur !== null && (overEur || nearEur) && (
                    <span
                      className={`text-[var(--fs-xs)] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        overEur ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {eur(e.monthEur)}/{eur(e.capEur)}
                    </span>
                  )}
                  <span className={`text-[var(--fs-sm)] font-bold tabular-nums flex-shrink-0 ${hoursTone}`}>
                    {hoursLabel(e.weekHours)}
                    {e.weekLimit !== null && (
                      <span className="text-gray-400 font-semibold"> / {hoursLabel(e.weekLimit)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {team.employees.length > TEAM_ROWS && (
            <div className="mt-1.5 text-[var(--fs-xs)] font-semibold text-green-700">
              +{team.employees.length - TEAM_ROWS} more · view roster →
            </div>
          )}
        </KpiCard>
      )}

      {/* 4 — Punctuality hot-spots */}
      {punct && (
        <KpiCard onClick={() => onNavigate('punctuality')} ariaLabel="Punctuality this week" className="p-4">
          <span className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">
            Punctuality · this week
          </span>
          {offenders.length > 0 ? (
            <div className="mt-1.5">
              {offenders.map(e => {
                const bits: string[] = [];
                if (e.lateCount > 0) bits.push(`${e.lateCount} late · ${e.lateMins}m`);
                if (e.earlyCount > 0) bits.push(`${e.earlyCount} left early`);
                return (
                  <FlagRow
                    key={e.employeeName}
                    tone={e.lateCount > 0 ? 'red' : 'amber'}
                    primary={firstName(e.employeeName)}
                    secondary={bits.join(' · ')}
                  />
                );
              })}
            </div>
          ) : (
            <div className="mt-1.5 text-[var(--fs-sm)] font-semibold text-green-700">
              Everyone on time this week ✓
            </div>
          )}
        </KpiCard>
      )}
    </div>
  );
}
