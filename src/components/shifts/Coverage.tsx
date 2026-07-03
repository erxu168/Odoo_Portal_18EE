'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, Spinner, StatChip, WeekNav } from '@/components/shifts/ui';
import { currentWeekKey, fmtDay, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * Coverage — manager week health check.
 * Week nav + 3 stat chips + one row per day with status badges:
 * green "Covered" / amber "N open" / red "N over cap" / gray "—" (no shifts).
 * Tapping a day jumps into Manage Shifts focused on that date.
 */

interface CoverageDay {
  date: string;
  shifts: number;
  open: number;
  overCap: number;
  cost: number;
}

interface CoverageTotals {
  shifts: number;
  open: number;
  overCap: number;
  cost: number;
}

interface ComplianceWarning {
  employee: string;
  kind: 'rest' | 'long';
  detail: string;
}

interface CoverageProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
  onOpenDay: (date: string) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 – 12 Jul" (or "29 Jun – 5 Jul" across a month boundary). */
function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const [, m1, d1] = days[0].split('-').map(Number);
  const [, m2, d2] = days[6].split('-').map(Number);
  if (m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

/** "Mon 6 Jul" from a pure "YYYY-MM-DD" date (noon UTC = same Berlin date). */
function dayLabel(date: string): string {
  return fmtDay(`${date} 12:00:00`);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export default function Coverage({ companyId, onBack, onOpenDay }: CoverageProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [days, setDays] = useState<CoverageDay[]>([]);
  const [totals, setTotals] = useState<CoverageTotals>({ shifts: 0, open: 0, overCap: 0, cost: 0 });
  const [warnings, setWarnings] = useState<ComplianceWarning[]>([]);
  const [confirmations, setConfirmations] = useState<{ confirmed: number; total: number }>({ confirmed: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/coverage?company_id=${companyId}&week=${weekKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Merge API days over the 7 calendar days so every row always renders.
      const byDate = new Map<string, CoverageDay>();
      const apiDays = Array.isArray(data.days) ? data.days : [];
      for (const d of apiDays) {
        if (d && typeof d.date === 'string') {
          byDate.set(d.date, {
            date: d.date,
            shifts: num(d.shifts),
            open: num(d.open),
            overCap: num(d.overCap),
            cost: num(d.cost),
          });
        }
      }
      setDays(
        weekKeyDays(weekKey).map(
          date => byDate.get(date) ?? { date, shifts: 0, open: 0, overCap: 0, cost: 0 }
        )
      );
      setTotals({
        shifts: num(data.totals?.shifts),
        open: num(data.totals?.open),
        overCap: num(data.totals?.overCap),
        cost: num(data.totals?.cost),
      });
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setConfirmations(
        data.confirmations && typeof data.confirmations === 'object'
          ? { confirmed: num(data.confirmations.confirmed), total: num(data.confirmations.total) }
          : { confirmed: 0, total: 0 },
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (companyId) fetchCoverage();
  }, [companyId, fetchCoverage]);

  function dayBadges(d: CoverageDay): React.ReactNode {
    if (d.shifts === 0) return <Badge variant="gray">—</Badge>;
    if (d.open === 0 && d.overCap === 0) return <Badge variant="green">Covered</Badge>;
    return (
      <span className="inline-flex gap-1">
        {d.open > 0 && <Badge variant="amber">{d.open} open</Badge>}
        {d.overCap > 0 && <Badge variant="red">{d.overCap} over cap</Badge>}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Coverage" showBack onBack={onBack} />

      <div className="pt-4">
        <WeekNav
          weekKey={weekKey}
          label={weekLabel(weekKey)}
          onPrev={() => setWeekKey(k => offsetWeekKey(k, -1))}
          onNext={() => setWeekKey(k => offsetWeekKey(k, 1))}
        />
      </div>

      <div className="px-4 pb-24 flex flex-col gap-3">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load coverage</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchCoverage}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <StatChip value={totals.shifts} label="Shifts" />
              <StatChip value={totals.open} label="Open" tone="amber" />
              <StatChip value={totals.overCap} label="Over cap" tone="red" />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[var(--fs-sm)] font-bold text-gray-900">Labour cost this week</div>
                <div className="text-[var(--fs-xs)] text-gray-500 leading-snug">
                  Wages at each person’s rate · min wage if no contract
                </div>
              </div>
              <div className="text-[var(--fs-xl)] font-extrabold text-gray-900 tabular-nums flex-shrink-0 pl-3">
                €{Math.round(totals.cost)}
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
                <div className="text-[var(--fs-md)] font-bold text-red-800 mb-1.5 flex items-center gap-2">
                  <span>{'⚠️'}</span> Working-time warnings (ArbZG)
                </div>
                <div className="flex flex-col gap-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="text-[var(--fs-sm)] text-red-800">
                      <span className="font-semibold">{w.employee}</span> · {w.detail}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {confirmations.total > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center justify-between">
                <div className="text-[var(--fs-sm)] font-bold text-gray-900">Confirmed by staff</div>
                <div
                  className={`text-[var(--fs-md)] font-bold tabular-nums ${
                    confirmations.confirmed < confirmations.total ? 'text-amber-600' : 'text-green-600'
                  }`}
                >
                  {confirmations.confirmed} / {confirmations.total}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              {days.map((d, i) => (
                <button
                  key={d.date}
                  onClick={() => onOpenDay(d.date)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 min-h-[44px] ${
                    i > 0 ? 'border-t border-gray-100' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-md)] font-bold text-gray-900">{dayLabel(d.date)}</div>
                    <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                      {d.shifts === 0
                        ? 'No shifts planned'
                        : `${d.shifts} shift${d.shifts === 1 ? '' : 's'}${d.cost > 0 ? ` · €${Math.round(d.cost)}` : ''}`}
                    </div>
                  </div>
                  <div className="flex-shrink-0">{dayBadges(d)}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
