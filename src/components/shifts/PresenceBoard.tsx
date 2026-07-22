'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import RecordLink from '@/components/ui/RecordLink';
import { Badge, Spinner, StatChip } from '@/components/shifts/ui';
import type { BadgeVariant } from '@/components/shifts/ui';
import { berlinParts, fmtTimeRange } from '@/lib/shifts-time';

/**
 * Right Now — manager live presence board.
 * Shows today's scheduled staff with their clock-in state derived from Odoo
 * hr.attendance (present / late / due / upcoming / done). Auto-refreshes so a
 * late arrival surfaces without reloading. Read-only.
 */

type PresenceState = 'present' | 'late' | 'due' | 'upcoming' | 'done';

interface PresenceRow {
  employeeId: number;
  employeeName: string;
  slotId: number;
  start: string;
  end: string;
  state: PresenceState;
  checkIn: string | null;
  minsLate: number;
}

interface UnscheduledPresent {
  employeeId: number;
  employeeName: string;
  checkIn: string;
  sinceBeforeToday: boolean;
}

interface PresenceProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

const STATE_META: Record<PresenceState, { variant: BadgeVariant; label: string }> = {
  present: { variant: 'green', label: 'Present' },
  late: { variant: 'red', label: 'Late' },
  due: { variant: 'amber', label: 'Due now' },
  upcoming: { variant: 'gray', label: 'Upcoming' },
  done: { variant: 'gray', label: 'Done' },
};

function hhmm(odoo: string | null): string {
  return odoo ? berlinParts(odoo).hhmm : '';
}

export default function PresenceBoard({ companyId, onBack }: PresenceProps) {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledPresent[]>([]);
  const [now, setNow] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPresence = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/shifts/presence?company_id=${companyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setUnscheduled(Array.isArray(data.unscheduledPresent) ? data.unscheduledPresent : []);
      setNow(typeof data.now === 'string' ? data.now : '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    fetchPresence();
    const timer = setInterval(fetchPresence, 45000);
    return () => clearInterval(timer);
  }, [companyId, fetchPresence]);

  // Count unique people present — someone with two shifts today is one person.
  const scheduledPresent = new Set(rows.filter(r => r.state === 'present').map(r => r.employeeId)).size;
  const presentCount = scheduledPresent + unscheduled.length;
  const lateRows = rows.filter(r => r.state === 'late');
  const lateNames = lateRows.map(r => r.employeeName).join(', ');
  const dayLabel = (odoo: string) => berlinParts(odoo).date.slice(5).replace('-', '/'); // MM/DD

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Right Now" showBack onBack={onBack} />

      <div className="px-4 pt-4 pb-24 flex flex-col gap-3 max-w-2xl mx-auto w-full">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load presence</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchPresence}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {now && (
              <div className="text-center text-[var(--fs-xs)] text-gray-400 -mt-1">
                As of {hhmm(now)} {'·'} updates automatically
              </div>
            )}

            {lateRows.length > 0 && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3.5">
                <span className="text-xl leading-none">{'⚠️'}</span>
                <div className="min-w-0">
                  <div className="text-[var(--fs-md)] font-bold text-red-800">{lateNames} not checked in</div>
                  <div className="text-[var(--fs-xs)] text-red-700 mt-0.5 opacity-90">
                    Scheduled but no clock-in past the grace time.
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <StatChip value={presentCount} label="Present" />
              <StatChip value={lateRows.length} label="Late" tone={lateRows.length > 0 ? 'red' : 'default'} />
              <StatChip value={rows.length} label="Scheduled" />
            </div>

            {unscheduled.length > 0 && (
              <div>
                <div className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-wider uppercase px-1 pb-1.5">
                  Clocked in · not on today{'’'}s rota
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  {unscheduled.map((u, i) => (
                    <div
                      key={u.employeeId}
                      className={`flex items-center gap-3 px-4 py-3 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{u.employeeName}</div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                          in since {hhmm(u.checkIn)}
                          {u.sinceBeforeToday ? ` · ${dayLabel(u.checkIn)}` : ''}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <Badge variant={u.sinceBeforeToday ? 'amber' : 'green'}>
                          {u.sinceBeforeToday ? 'Still in?' : 'Present'}
                        </Badge>
                        <RecordLink type="employee" id={u.employeeId} label={u.employeeName} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rows.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-[var(--fs-base)]">
                {unscheduled.length === 0 ? 'Nobody is scheduled or clocked in.' : 'Nobody scheduled today.'}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {rows.map((r, i) => {
                  const meta = STATE_META[r.state];
                  return (
                    <div
                      key={r.slotId}
                      className={`flex items-center gap-3 px-4 py-3 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                          {r.employeeName}
                        </div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                          {fmtTimeRange(r.start, r.end)}
                          {r.state === 'present' && r.checkIn ? ` · in since ${hhmm(r.checkIn)}` : ''}
                          {r.state === 'late' ? ` · ${r.minsLate} min late` : ''}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <RecordLink type="employee" id={r.employeeId ?? 0} label={r.employeeName} canOpen={r.employeeId != null} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
