'use client';

/**
 * Shifts — My Hours (staff).
 * Compact list of weekly totals (GET /api/shifts/hours): hours vs cap per
 * week, with a red over-cap flag when a week exceeds the personal cap.
 */

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, EmptyState, SearchBar, SectionTitle, Spinner } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import { currentWeekKey, weekKeyDays } from '@/lib/shifts-time';

interface MyHoursProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

interface HoursWeek {
  weekKey: string;
  hours: number;
  cap: number | null;
  over: boolean;
}

const DAY_MONTH_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

/** "6 – 12 Jul" from a week key. */
function weekRange(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const a = DAY_MONTH_FMT.format(new Date(`${days[0]}T00:00:00Z`));
  const b = DAY_MONTH_FMT.format(new Date(`${days[6]}T00:00:00Z`));
  const [ad, am] = a.split(' ');
  const bm = b.split(' ')[1];
  return am === bm ? `${ad} – ${b}` : `${a} – ${b}`;
}

export default function MyHours({ companyId, employeeId, onBack }: MyHoursProps) {
  const [weeks, setWeeks] = useState<HoursWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/hours?company_id=${companyId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setWeeks(Array.isArray(data.weeks) ? data.weeks : []);
    } catch (err: unknown) {
      console.error('[shifts] Failed to load hours:', err);
      setError(err instanceof Error ? err.message : 'Could not load your hours');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (employeeId !== null) void load();
  }, [load, employeeId]);

  if (employeeId === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Shifts" title="My Hours" showBack onBack={onBack} />
        <EmptyState
          icon="🔗"
          title="Account not linked"
          body="Your account isn’t linked to an employee record. Ask your manager to connect it in Manage Staff."
        />
      </div>
    );
  }

  const nowKey = currentWeekKey();
  const q = search.trim().toLowerCase();
  const filtered = weeks.filter(w => {
    if (!q) return true;
    return w.weekKey.toLowerCase().includes(q) || weekRange(w.weekKey).toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="Shifts"
        title="My Hours"
        subtitle="Your weekly totals"
        showBack
        onBack={onBack}
      />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load your hours</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="pt-3">
            <SearchBar value={search} onChange={setSearch} placeholder="Search weeks…" />
          </div>

          <div className="px-4 pb-24">
            <SectionTitle>Week by week</SectionTitle>

            {loading ? (
              <Spinner />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="⏱️"
                title={q ? 'No matches' : 'No hours yet'}
                body={q ? 'Try a different search.' : 'Once you have shifts, your weekly totals show up here.'}
              />
            ) : (
              <div className={ds.card}>
                {filtered.map((w, i) => (
                  <React.Fragment key={w.weekKey}>
                    {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900">{weekRange(w.weekKey)}</div>
                        <div className="text-[var(--fs-sm)] text-gray-500">
                          {w.weekKey === nowKey ? 'This week' : `Week ${w.weekKey.split('-W')[1] ?? ''}`}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div
                          className={`text-[var(--fs-md)] font-bold tabular-nums ${w.over ? 'text-red-700' : 'text-gray-900'}`}
                        >
                          {`${fmtH(w.hours)}${w.cap !== null ? ` / ${fmtCap(w.cap)}` : ''} h`}
                        </div>
                        {w.over && (
                          <div className="mt-1">
                            <Badge variant="red">Over cap</Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
