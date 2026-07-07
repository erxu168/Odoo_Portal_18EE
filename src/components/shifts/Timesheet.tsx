'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, StatChip, WeekNav } from '@/components/shifts/ui';
import { berlinParts, currentWeekKey, fmtDay, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * Timesheets — §17 MiLoG working-time records (manager, read-only).
 * Week nav + per-employee daily start/end/duration from Odoo hr.attendance,
 * plus a CSV export (the audit-ready record the Zoll can request).
 */

interface TEntry {
  date: string;
  checkIn: string;
  checkOut: string | null;
  hours: number;
}
interface TEmp {
  employeeId: number;
  employeeName: string;
  entries: TEntry[];
  totalHours: number;
}
interface TimesheetProps {
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
function hhmm(odoo: string | null): string {
  return odoo ? berlinParts(odoo).hhmm : '—';
}
function dayShort(date: string): string {
  return fmtDay(`${date} 12:00:00`);
}
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Timesheet({ companyId, onBack }: TimesheetProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [employees, setEmployees] = useState<TEmp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimesheet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/timesheet?company_id=${companyId}&week=${weekKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmployees(Array.isArray(data.employees) ? data.employees : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (companyId) fetchTimesheet();
  }, [companyId, fetchTimesheet]);

  function exportCsv() {
    const rows: string[][] = [['Employee', 'Date', 'Start', 'End', 'Hours']];
    for (const e of employees) {
      for (const en of e.entries) {
        rows.push([e.employeeName, en.date, hhmm(en.checkIn), hhmm(en.checkOut), en.hours.toFixed(2)]);
      }
    }
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${weekKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const totalHours = Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100;
  const entryCount = employees.reduce((s, e) => s + e.entries.length, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Timesheets" showBack onBack={onBack} />

      <div className="pt-4">
        <WeekNav
          weekKey={weekKey}
          label={weekLabel(weekKey)}
          onPrev={() => setWeekKey(k => offsetWeekKey(k, -1))}
          onNext={() => setWeekKey(k => offsetWeekKey(k, 1))}
        />
      </div>

      <div className="px-4 pb-24 flex flex-col gap-3 max-w-2xl mx-auto w-full">
        <div className="bg-gray-100 border border-gray-200 rounded-xl px-3.5 py-2.5 text-[var(--fs-xs)] text-gray-600 leading-relaxed">
          §17 MiLoG working-time record — start, end and duration per day, from the Time
          Attendance clock. Keep 2 years.
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load timesheets</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchTimesheet}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <StatChip value={employees.length} label="Staff" />
              <StatChip value={entryCount} label="Days" />
              <StatChip value={totalHours} label="Hours" />
            </div>

            <button
              onClick={exportCsv}
              disabled={entryCount === 0}
              className="w-full h-12 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV (§17)
            </button>

            {employees.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-[var(--fs-base)]">
                No clock-ins recorded this week.
              </div>
            ) : (
              employees.map(e => (
                <div key={e.employeeId} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{e.employeeName}</div>
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900 tabular-nums flex-shrink-0">
                      {e.totalHours}h
                    </div>
                  </div>
                  {e.entries.map((en, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-sm)] font-semibold text-gray-800">{dayShort(en.date)}</div>
                        <div className="text-[var(--fs-xs)] text-gray-500 tabular-nums">
                          {hhmm(en.checkIn)} – {hhmm(en.checkOut)}
                        </div>
                      </div>
                      <div className="text-[var(--fs-sm)] text-gray-700 tabular-nums flex-shrink-0">
                        {en.hours.toFixed(2)}h
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
