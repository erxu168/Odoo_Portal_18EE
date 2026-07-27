'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, Spinner, StatChip } from '@/components/shifts/ui';
import { currentWeekKey, offsetWeekKey } from '@/lib/shifts-time';

/**
 * ComplianceReport — manager view of attendance compliance over a period.
 * Aggregates late / early / overtime / missed rest breaks / acknowledgements per
 * employee (all derived on demand, reusing the punctuality + overtime logic), and
 * highlights repeat offenders. Read-only.
 */

interface CEmployee {
  employeeId: number;
  employeeName: string;
  matchedShifts: number;
  lateCount: number;
  lateMins: number;
  earlyCount: number;
  earlyMins: number;
  missedBreakCount: number;
  breakShortfallMins: number;
  overtimePendingCount: number;
  overtimePendingMins: number;
  overtimeApprovedCount: number;
  overtimeApprovedMins: number;
  overtimeRejectedCount: number;
  overtimeRejectedMins: number;
  ackCount: number;
  ackDistinctDays: number;
  adverseCount: number;
}

interface Report {
  from: string;
  to: string;
  weeks: string[];
  employees: CEmployee[];
  repeatOffenders: CEmployee[];
  diagnostics: { unmatched: number; ambiguous: number };
}

interface ComplianceProps {
  companyId: number;
  onBack: () => void;
}

const PRESETS = [
  { weeks: 4, label: '4 weeks' },
  { weeks: 8, label: '8 weeks' },
  { weeks: 12, label: '12 weeks' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: string): string {
  const [, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}`;
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export default function ComplianceReport({ companyId, onBack }: ComplianceProps) {
  const [weeks, setWeeks] = useState(4);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setReport(null);
    const toWeek = currentWeekKey();
    const fromWeek = offsetWeekKey(toWeek, -(weeks - 1));
    try {
      const res = await fetch(`/api/shifts/compliance?company_id=${companyId}&from=${fromWeek}&to=${toWeek}`);
      const data = await res.json();
      if (myReq !== reqIdRef.current) return;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReport(data);
    } catch (err: unknown) {
      if (myReq !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [companyId, weeks]);

  useEffect(() => {
    if (companyId) load();
  }, [companyId, load]);

  const totals = useMemo(() => {
    const t = { late: 0, early: 0, missedBreak: 0, overtimePending: 0 };
    for (const e of report?.employees ?? []) {
      t.late += e.lateCount;
      t.early += e.earlyCount;
      t.missedBreak += e.missedBreakCount;
      t.overtimePending += e.overtimePendingCount;
    }
    return t;
  }, [report]);

  const card = (e: CEmployee) => (
    <div key={e.employeeId} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
          {initials(e.employeeName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{e.employeeName}</div>
          <div className="text-[var(--fs-xs)] text-gray-500">{e.matchedShifts} shift{e.matchedShifts === 1 ? '' : 's'} in range</div>
        </div>
        {e.adverseCount === 0 && <Badge variant="green">All clear</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={e.lateCount ? 'red' : 'gray'}>⏰ Late {e.lateCount}× · {e.lateMins}m</Badge>
        <Badge variant={e.earlyCount ? 'amber' : 'gray'}>🚪 Early {e.earlyCount}× · {e.earlyMins}m</Badge>
        <Badge variant={e.missedBreakCount ? 'red' : 'gray'}>☕ Missed break {e.missedBreakCount}×</Badge>
        {(e.overtimePendingCount > 0 || e.overtimeApprovedCount > 0) && (
          <Badge variant="blue">
            ➕ OT {e.overtimeApprovedCount ? `${e.overtimeApprovedCount} ok` : ''}
            {e.overtimeApprovedCount && e.overtimePendingCount ? ' · ' : ''}
            {e.overtimePendingCount ? `${e.overtimePendingCount} to review` : ''}
          </Badge>
        )}
        {e.ackCount > 0 && <Badge variant="gray">✅ Ack {e.ackDistinctDays}d</Badge>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Compliance" showBack onBack={onBack} />

      <div className="px-4 pt-4 pb-24 flex flex-col gap-3 max-w-2xl mx-auto w-full">
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button
              key={p.weeks}
              onClick={() => setWeeks(p.weeks)}
              className={`flex-1 h-10 rounded-xl text-[var(--fs-sm)] font-bold border ${
                weeks === p.weeks
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
              }`}
            >
              Last {p.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load the report</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button onClick={load} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700">
              Retry
            </button>
          </div>
        ) : !report || report.employees.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-[var(--fs-base)]">
            No attendance matched a shift in this period.
          </div>
        ) : (
          <>
            <div className="text-[var(--fs-xs)] text-gray-500 px-1">
              {fmtDate(report.from)} – {fmtDate(report.to)} · {report.weeks.length} week{report.weeks.length === 1 ? '' : 's'}
            </div>
            <div className="flex gap-2">
              <StatChip value={totals.late} label="Late" tone={totals.late ? 'red' : 'default'} />
              <StatChip value={totals.early} label="Left early" tone={totals.early ? 'amber' : 'default'} />
              <StatChip value={totals.missedBreak} label="Missed breaks" tone={totals.missedBreak ? 'red' : 'default'} />
              <StatChip value={totals.overtimePending} label="OT to review" tone={totals.overtimePending ? 'amber' : 'default'} />
            </div>

            {report.repeatOffenders.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <div className="text-[var(--fs-sm)] font-bold text-red-800 mb-2">⚠ Needs attention</div>
                <div className="flex flex-col gap-1.5">
                  {report.repeatOffenders.map(e => (
                    <div key={e.employeeId} className="flex items-center justify-between text-[var(--fs-sm)]">
                      <span className="font-semibold text-gray-900 truncate">{e.employeeName}</span>
                      <span className="text-red-700 text-[var(--fs-xs)] flex-shrink-0 ml-2">
                        {e.lateCount ? `${e.lateCount} late` : ''}
                        {e.lateCount && (e.earlyCount || e.missedBreakCount) ? ' · ' : ''}
                        {e.earlyCount ? `${e.earlyCount} early` : ''}
                        {e.earlyCount && e.missedBreakCount ? ' · ' : ''}
                        {e.missedBreakCount ? `${e.missedBreakCount} no-break` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.employees.map(card)}

            {(report.diagnostics.unmatched > 0 || report.diagnostics.ambiguous > 0) && (
              <div className="text-center text-[var(--fs-xs)] text-gray-400 mt-1">
                {report.diagnostics.unmatched > 0 && <div>{report.diagnostics.unmatched} clock-in(s) had no scheduled shift to compare against.</div>}
                {report.diagnostics.ambiguous > 0 && <div>{report.diagnostics.ambiguous} clock-in(s) matched several shifts that day — skipped.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
