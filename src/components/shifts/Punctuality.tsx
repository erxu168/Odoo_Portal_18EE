'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, Spinner, WeekNav } from '@/components/shifts/ui';
import { currentWeekKey, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * Punctuality — manager view of late arrivals, early leaves and overtime.
 * Built by matching clock-ins (hr.attendance) to scheduled shifts. Worst first.
 * Records not yet linked to a shift are noted as "not yet matched".
 */

interface PEmp {
  employeeId: number;
  employeeName: string;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  overCount: number;
  overMins: number;
  matched: number;
}
interface PunctualityProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const [, m1, d1] = days[0].split('-').map(Number);
  const [, m2, d2] = days[6].split('-').map(Number);
  if (m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export default function Punctuality({ companyId, onBack }: PunctualityProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [employees, setEmployees] = useState<PEmp[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPunctuality = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/punctuality?company_id=${companyId}&week=${weekKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmployees(Array.isArray(data.employees) ? data.employees : []);
      setUnmatched(typeof data.unmatched === 'number' ? data.unmatched : 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (companyId) fetchPunctuality();
  }, [companyId, fetchPunctuality]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Punctuality" showBack onBack={onBack} />

      <div className="pt-4">
        <WeekNav
          weekKey={weekKey}
          label={weekLabel(weekKey)}
          onPrev={() => setWeekKey(k => offsetWeekKey(k, -1))}
          onNext={() => setWeekKey(k => offsetWeekKey(k, 1))}
        />
      </div>

      <div className="px-4 pb-24 flex flex-col gap-3 max-w-2xl mx-auto w-full">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load punctuality</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchPunctuality}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-[var(--fs-base)]">
            No matched clock-ins this week.
            {unmatched > 0 && (
              <div className="text-[var(--fs-xs)] text-gray-400 mt-2">
                {unmatched} clock-in{unmatched === 1 ? '' : 's'} not yet linked to a shift.
              </div>
            )}
          </div>
        ) : (
          <>
            {employees.map(e => {
              const clean = e.lateCount + e.earlyCount === 0;
              return (
                <div key={e.employeeId} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
                      {initials(e.employeeName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{e.employeeName}</div>
                      <div className="text-[var(--fs-xs)] text-gray-500">{e.matched} shift{e.matched === 1 ? '' : 's'} matched</div>
                    </div>
                    {clean && <Badge variant="green">On time</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={e.lateCount ? 'red' : 'gray'}>
                      ⏰ Late {e.lateCount}× · {e.lateMins} min
                    </Badge>
                    <Badge variant={e.earlyCount ? 'amber' : 'gray'}>
                      🚪 Left early {e.earlyCount}× · {e.earlyMins} min
                    </Badge>
                    <Badge variant={e.overCount ? 'blue' : 'gray'}>
                      ➕ Overtime {e.overCount}× · {e.overMins} min
                    </Badge>
                  </div>
                </div>
              );
            })}
            {unmatched > 0 && (
              <div className="text-center text-[var(--fs-xs)] text-gray-400 mt-1">
                {unmatched} clock-in{unmatched === 1 ? '' : 's'} not yet linked to a shift (they’ll match as staff clock in
                against their shift on the kiosk).
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
