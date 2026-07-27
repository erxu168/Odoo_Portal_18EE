'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, Spinner, StatChip, WeekNav } from '@/components/shifts/ui';
import { currentWeekKey, offsetWeekKey, weekKeyDays } from '@/lib/shifts-time';

/**
 * OvertimeApprovals — manager view to approve or reject overtime for the week.
 * An "overtime event" is any shift where the person clocked out past the grace
 * period. Events are derived live from clock-ins vs the schedule; only the
 * approve/reject decision is stored. Deciding updates the row in place (no reload,
 * so the list never jumps to the top). Counts are derived from the rows, and a
 * stale response for an old week/company is ignored, so nothing can desync.
 */

type OvertimeStatus = 'pending' | 'approved' | 'rejected';

interface OvertimeRow {
  attendanceId: number;
  employeeId: number;
  employeeName: string;
  date: string;
  shift: string;
  overtimeMins: number;
  status: OvertimeStatus;
  effectiveStatus: OvertimeStatus;
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decidedMins: number | null;
  changedSinceDecided: boolean;
}

interface OvertimeApprovalsProps {
  companyId: number;
  onBack: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const [, m1, d1] = days[0].split('-').map(Number);
  const [, m2, d2] = days[6].split('-').map(Number);
  if (m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}
function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${WD[wd]} ${day} ${MONTHS[m - 1]}`;
}
function fmtMins(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const mm = n % 60;
  return mm ? `${h}h ${String(mm).padStart(2, '0')}m` : `${h}h`;
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export default function OvertimeApprovals({ companyId, onBack }: OvertimeApprovalsProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // load failure (full-screen)
  const [notice, setNotice] = useState<string | null>(null); // action outcome (inline)
  const [saving, setSaving] = useState<Set<number>>(new Set());
  // Only the latest load may write state — an old week's slow response is dropped.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    // Drop the current rows up front: if this load fails (or the week/company
    // changed), we must never keep showing stale, still-actionable rows.
    setRows([]);
    try {
      const res = await fetch(`/api/shifts/overtime?company_id=${companyId}&week=${weekKey}`);
      const data = await res.json();
      if (myReq !== reqIdRef.current) return; // superseded
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: unknown) {
      if (myReq !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (companyId) load();
  }, [companyId, load]);

  // Counts are always derived from the rows we are actually showing — they can
  // never drift from an in-place decision or a stale summary payload.
  const summary = useMemo(() => {
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let pendingMins = 0;
    for (const r of rows) {
      if (r.effectiveStatus === 'approved') approvedCount++;
      else if (r.effectiveStatus === 'rejected') rejectedCount++;
      else {
        pendingCount++;
        pendingMins += r.overtimeMins;
      }
    }
    return { pendingCount, approvedCount, rejectedCount, pendingMins };
  }, [rows]);

  const decide = useCallback(
    async (row: OvertimeRow, status: OvertimeStatus) => {
      const reqAtStart = reqIdRef.current;
      setSaving(prev => new Set(prev).add(row.attendanceId));
      setNotice(null);
      try {
        const res = await fetch('/api/shifts/overtime/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            week: weekKey,
            attendance_id: row.attendanceId,
            status,
            expected_mins: row.overtimeMins,
          }),
        });
        const data = await res.json();
        // If the week/company changed under us, the decision no longer applies here.
        if (reqAtStart !== reqIdRef.current) return;
        if (res.status === 409) {
          // The punch changed under us. Fix just this row in place (no reload, so
          // the list doesn't jump): re-open it for review at the new amount, or
          // drop it if the overtime no longer exists at all.
          setNotice(data.error || 'That overtime changed — please review it again.');
          if (data.code === 'changed' && typeof data.overtimeMins === 'number') {
            const newMins = data.overtimeMins;
            setRows(prev =>
              prev.map(r =>
                r.attendanceId === row.attendanceId
                  ? { ...r, overtimeMins: newMins, effectiveStatus: 'pending', changedSinceDecided: r.status !== 'pending' }
                  : r,
              ),
            );
          } else {
            setRows(prev => prev.filter(r => r.attendanceId !== row.attendanceId));
          }
          return;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const mins = typeof data.overtimeMins === 'number' ? data.overtimeMins : row.overtimeMins;
        // Optimistic in-place update — never reload the list (no scroll jump).
        setRows(prev =>
          prev.map(r =>
            r.attendanceId === row.attendanceId
              ? {
                  ...r,
                  overtimeMins: mins,
                  status,
                  effectiveStatus: status,
                  decidedMins: mins,
                  changedSinceDecided: false,
                  decidedByName: 'You',
                  decidedAt: new Date().toISOString(),
                }
              : r,
          ),
        );
      } catch (err: unknown) {
        if (reqAtStart === reqIdRef.current) setNotice(err instanceof Error ? err.message : 'Could not save. Please try again.');
      } finally {
        setSaving(prev => {
          const next = new Set(prev);
          next.delete(row.attendanceId);
          return next;
        });
      }
    },
    [companyId, weekKey],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Overtime approvals" showBack onBack={onBack} />

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
        ) : error && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load overtime</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={load}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {notice && (
              <div className="text-[var(--fs-xs)] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {notice}
              </div>
            )}
            {rows.length === 0 ? (
              <div className="text-center py-16 text-gray-500 text-[var(--fs-base)]">
                No overtime to review this week.
                <div className="text-[var(--fs-xs)] text-gray-400 mt-2">
                  Overtime appears here when someone clocks out past the grace period after their shift ends.
                </div>
              </div>
            ) : (
              <>
            <div className="flex gap-2 pt-1">
              <StatChip value={summary.pendingCount} label="To review" tone={summary.pendingCount ? 'amber' : 'default'} />
              <StatChip value={fmtMins(summary.pendingMins)} label="Pending time" tone={summary.pendingMins ? 'amber' : 'default'} />
              <StatChip value={summary.approvedCount} label="Approved" />
              <StatChip value={summary.rejectedCount} label="Rejected" />
            </div>

            {rows.map(r => {
              const busy = saving.has(r.attendanceId);
              const decided = r.status !== 'pending';
              return (
                <div key={r.attendanceId} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
                      {initials(r.employeeName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{r.employeeName}</div>
                      <div className="text-[var(--fs-xs)] text-gray-500">
                        {fmtDate(r.date)} · {r.shift}
                      </div>
                    </div>
                    <Badge variant="blue">➕ {fmtMins(r.overtimeMins)}</Badge>
                  </div>

                  {r.changedSinceDecided && (
                    <div className="mb-3 text-[var(--fs-xs)] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠ Recorded time changed since this was decided
                      {r.decidedMins !== null ? ` (was ${fmtMins(r.decidedMins)}, now ${fmtMins(r.overtimeMins)})` : ''}. Please review again.
                    </div>
                  )}

                  {decided && !r.changedSinceDecided && (
                    <div className="mb-3 text-[var(--fs-xs)] text-gray-500">
                      {r.status === 'approved' ? '✅ Approved' : '⛔ Rejected'}
                      {r.decidedByName ? ` by ${r.decidedByName}` : ''}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {r.effectiveStatus !== 'approved' && (
                      <button
                        disabled={busy}
                        onClick={() => decide(r, 'approved')}
                        className="flex-1 h-11 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-50"
                      >
                        {busy ? '…' : 'Approve'}
                      </button>
                    )}
                    {r.effectiveStatus !== 'rejected' && (
                      <button
                        disabled={busy}
                        onClick={() => decide(r, 'rejected')}
                        className="flex-1 h-11 rounded-xl bg-white border border-red-300 text-red-700 text-[var(--fs-sm)] font-bold active:bg-red-50 disabled:opacity-50"
                      >
                        {busy ? '…' : 'Reject'}
                      </button>
                    )}
                    {decided && (
                      <button
                        disabled={busy}
                        onClick={() => decide(r, 'pending')}
                        className="px-4 h-11 rounded-xl bg-gray-100 text-gray-600 text-[var(--fs-sm)] font-bold active:bg-gray-200 disabled:opacity-50"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
