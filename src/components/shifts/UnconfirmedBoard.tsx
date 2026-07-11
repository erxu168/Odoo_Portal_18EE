'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, Spinner } from '@/components/shifts/ui';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';

/**
 * Manager "Not yet confirmed" board — assigned, published, future shifts whose
 * staff member hasn't confirmed. Per shift: nudge (re-send a push), mark
 * confirmed (someone confirmed by phone), or release back to the open pool.
 * Overdue rows (past the confirm-by cutoff) are red. No auto-release — the
 * manager always decides.
 */

interface UnconfirmedShift {
  slotId: number;
  employeeId: number | null;
  employeeName: string;
  start: string;
  end: string;
  roleName: string;
  departmentName: string;
  confirmBy: string;
  remindersSent: number;
  overdue: boolean;
}

interface BoardData {
  enabled: boolean;
  shifts: UnconfirmedShift[];
  overdueCount: number;
}

interface Props {
  companyId: number;
  isManager?: boolean;
  employeeId?: number | null;
  onBack: () => void;
  onHome: () => void;
}

function confirmByLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function UnconfirmedBoard({ companyId, onBack }: Props) {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<UnconfirmedShift | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/unconfirmed?company_id=${companyId}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: object): Promise<void> {
    const res = await fetch(url, { method: url.includes('/slots/') ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  }

  async function nudge(s: UnconfirmedShift) {
    setBusySlot(s.slotId);
    try {
      await post('/api/shifts/confirm/nudge', { company_id: companyId, slot_id: s.slotId });
      showToast(`Reminder sent to ${s.employeeName || 'them'}`);
      void load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusySlot(null);
    }
  }

  async function markConfirmed(s: UnconfirmedShift) {
    setBusySlot(s.slotId);
    try {
      await post('/api/shifts/confirm', { company_id: companyId, slot_id: s.slotId, employee_id: s.employeeId });
      showToast('Marked confirmed');
      void load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not confirm');
    } finally {
      setBusySlot(null);
    }
  }

  async function release() {
    if (!releaseTarget) return;
    const s = releaseTarget;
    setReleaseTarget(null);
    setBusySlot(s.slotId);
    try {
      await post(`/api/shifts/slots/${s.slotId}`, { company_id: companyId, assign_employee_id: null });
      showToast('Shift returned to the open pool');
      void load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not release');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Not yet confirmed" showBack onBack={onBack} />
      <div className="pb-28 max-w-xl mx-auto w-full px-4 pt-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center py-16">
            <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Could not load</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-4 text-center">{error}</p>
            <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
              Retry
            </button>
          </div>
        ) : !data ? null : (
          <>
            {!data.enabled && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[var(--fs-sm)] text-amber-800">
                Shift confirmation is off. Turn it on in Shift Settings to start chasing confirmations.
              </div>
            )}
            {data.shifts.length === 0 ? (
              <EmptyState icon="✅" title="All confirmed" body="Everyone has confirmed their upcoming shifts." />
            ) : (
              <>
                <p className="text-[var(--fs-sm)] text-gray-500 mb-3">
                  <b className="text-gray-800">{data.shifts.length}</b> shift{data.shifts.length === 1 ? '' : 's'} not confirmed
                  {data.overdueCount > 0 && (
                    <> · <span className="text-red-600 font-semibold">{data.overdueCount} overdue</span></>
                  )}
                </p>
                <div className="flex flex-col gap-2.5">
                  {data.shifts.map(s => (
                    <div key={s.slotId} className={`bg-white rounded-xl border p-3.5 ${s.overdue ? 'border-red-300' : 'border-gray-200'}`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{s.employeeName || 'Unnamed'}</div>
                          <div className="text-[var(--fs-sm)] text-gray-500">
                            {fmtDay(s.start)} · {fmtTimeRange(s.start, s.end)}{s.roleName ? ` · ${s.roleName}` : ''}
                          </div>
                          <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">
                            {s.remindersSent} reminder{s.remindersSent === 1 ? '' : 's'} sent · confirm by {confirmByLabel(s.confirmBy)}
                          </div>
                        </div>
                        {s.overdue ? <Badge variant="red">Overdue</Badge> : <Badge variant="orange">Waiting</Badge>}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button
                          disabled={busySlot === s.slotId}
                          onClick={() => void nudge(s)}
                          className="flex-1 px-3 py-2.5 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-lg active:bg-green-700 disabled:opacity-50"
                        >
                          Nudge
                        </button>
                        <button
                          disabled={busySlot === s.slotId}
                          onClick={() => void markConfirmed(s)}
                          className="px-3 py-2.5 border border-gray-200 text-gray-700 text-[var(--fs-sm)] font-semibold rounded-lg active:bg-gray-50 disabled:opacity-50"
                        >
                          Mark confirmed
                        </button>
                        <button
                          disabled={busySlot === s.slotId}
                          onClick={() => setReleaseTarget(s)}
                          className="px-3 py-2.5 border border-gray-200 text-red-600 text-[var(--fs-sm)] font-semibold rounded-lg active:bg-red-50 disabled:opacity-50"
                        >
                          Release
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {releaseTarget && (
        <ConfirmDialog
          title="Release this shift?"
          message={`${releaseTarget.employeeName || 'This person'}’s shift goes back to the open pool for someone else to claim. They’ll be notified.`}
          confirmLabel="Release"
          cancelLabel="Keep it"
          variant="danger"
          onConfirm={() => void release()}
          onCancel={() => setReleaseTarget(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-10 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-sm)] font-semibold text-white shadow-lg max-w-[90vw] text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
