'use client';

/**
 * Shifts — Open Shifts (staff).
 * Published, unassigned, future shifts of the company, grouped by day, with a
 * running week-total header. Tapping a shift opens the claim sheet: green
 * confirm when under cap, amber "Take it anyway" variant when the claim would
 * push the week over the personal cap (server decides via needsConfirm).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, EmptyState, SearchBar, SectionTitle, Sheet, Spinner } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import { fmtDay, fmtTimeRange } from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';

interface OpenShiftsListProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

type OpenShift = ShiftSlot & { eligible: boolean };

interface ClaimWarning {
  projected: number;
  cap: number;
  overage: number;
}

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

function WarnBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 bg-amber-100 rounded-xl px-3.5 py-3 text-[var(--fs-sm)] leading-relaxed text-amber-800">
      <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>{children}</div>
    </div>
  );
}

export default function OpenShiftsList({ companyId, employeeId, onBack }: OpenShiftsListProps) {
  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [weekHours, setWeekHours] = useState(0);
  const [cap, setCap] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<OpenShift | null>(null);
  const [warn, setWarn] = useState<ClaimWarning | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/open?company_id=${companyId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setShifts(Array.isArray(data.shifts) ? data.shifts : []);
      setWeekHours(typeof data.weekHours === 'number' ? data.weekHours : 0);
      setCap(typeof data.cap === 'number' ? data.cap : null);
    } catch (err: unknown) {
      console.error('[shifts] Failed to load open shifts:', err);
      setError(err instanceof Error ? err.message : 'Could not load open shifts');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (employeeId !== null) void load();
  }, [load, employeeId]);

  function closeSheet() {
    setSelected(null);
    setWarn(null);
    setSheetError(null);
  }

  async function claim(confirmOverage: boolean) {
    if (!selected) return;
    setClaiming(true);
    setSheetError(null);
    try {
      const res = await fetch('/api/shifts/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, slot_id: selected.id, confirm: confirmOverage }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        closeSheet();
        showToast(typeof data.error === 'string' ? data.error : 'Someone already took this shift');
        void load();
        return;
      }
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      if (data.needsConfirm) {
        setWarn({
          projected: typeof data.projected === 'number' ? data.projected : 0,
          cap: typeof data.cap === 'number' ? data.cap : 0,
          overage: typeof data.overage === 'number' ? data.overage : 0,
        });
        return;
      }
      closeSheet();
      showToast('The shift is yours');
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setClaiming(false);
    }
  }

  if (employeeId === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Planning" title="Open Shifts" showBack onBack={onBack} />
        <EmptyState
          icon="🔗"
          title="Account not linked"
          body="Your account isn’t linked to an employee record. Ask your manager to connect it in Manage Staff."
        />
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = shifts.filter(s => {
    if (!q) return true;
    return (
      (s.roleName || '').toLowerCase().includes(q) ||
      fmtDay(s.start).toLowerCase().includes(q) ||
      fmtTimeRange(s.start, s.end).includes(q) ||
      (s.note || '').toLowerCase().includes(q)
    );
  });

  const groups: { day: string; shifts: OpenShift[] }[] = [];
  for (const s of filtered) {
    const day = fmtDay(s.start);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.shifts.push(s);
    else groups.push({ day, shifts: [s] });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="Planning"
        title="Open Shifts"
        subtitle="Shifts nobody has taken yet"
        showBack
        onBack={onBack}
      />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load open shifts</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="pt-3">
            <SearchBar value={search} onChange={setSearch} placeholder="Search open shifts…" />
          </div>

          <div className="px-4 pb-24 max-w-2xl mx-auto w-full">
            <SectionTitle>
              {`This week · ${fmtH(weekHours)}${cap !== null ? ` / ${fmtCap(cap)}` : ''} h`}
            </SectionTitle>

            {loading ? (
              <Spinner />
            ) : groups.length === 0 ? (
              <EmptyState
                icon="📅"
                title={q ? 'No matches' : 'No open shifts'}
                body={q ? 'Try a different search.' : 'When your manager publishes shifts nobody has claimed, they show up here.'}
              />
            ) : (
              groups.map(group => (
                <div key={group.day}>
                  <SectionTitle>{group.day}</SectionTitle>
                  <div className={ds.card}>
                    {group.shifts.map((s, i) => (
                      <React.Fragment key={s.id}>
                        {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                        <button
                          onClick={() => {
                            if (!s.eligible) return;
                            setSelected(s);
                            setWarn(null);
                            setSheetError(null);
                          }}
                          disabled={!s.eligible}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left ${s.eligible ? 'active:bg-gray-50' : 'opacity-50'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[var(--fs-md)] font-bold text-gray-900">
                              {fmtTimeRange(s.start, s.end)}
                            </div>
                            <div className="text-[var(--fs-sm)] text-gray-500 truncate">
                              {`${s.roleName || 'Any role'} · ${fmtH(s.hours)} h`}
                            </div>
                            {s.note && (
                              <div className="text-[var(--fs-xs)] text-gray-400 truncate">{s.note}</div>
                            )}
                          </div>
                          {s.eligible ? (
                            <Badge variant="green">Open</Badge>
                          ) : (
                            <Badge variant="gray">Not your role</Badge>
                          )}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      <Sheet open={selected !== null} onClose={closeSheet}>
        {selected && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">
                {`${fmtDay(selected.start)} · ${fmtTimeRange(selected.start, selected.end)}`}
              </div>
              <div className="text-[var(--fs-sm)] text-gray-500">
                {`${selected.roleName || 'Any role'} · ${fmtH(selected.hours)} hours`}
              </div>
            </div>

            {selected.note && (
              <div>
                <div className={LBL}>Note</div>
                <div className="bg-gray-100 rounded-lg px-3 py-2.5 text-[var(--fs-sm)] text-gray-700">
                  {selected.note}
                </div>
              </div>
            )}

            {warn && (
              <WarnBox>
                Taking this puts you at <b>{`${fmtH(warn.projected)} of ${fmtCap(warn.cap)} hours`}</b> that week
                {' — '}
                <b>{`${fmtH(warn.overage)} h over`}</b> your cap.
              </WarnBox>
            )}

            {sheetError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {sheetError}
              </div>
            )}

            {warn ? (
              <>
                <button
                  onClick={() => void claim(true)}
                  disabled={claiming}
                  className="w-full bg-amber-500 text-white font-semibold rounded-xl py-3.5 text-[var(--fs-md)] active:bg-amber-600 shadow-lg shadow-amber-500/30 disabled:opacity-50"
                >
                  {claiming ? 'Taking…' : 'Take it anyway'}
                </button>
                <div className="text-[var(--fs-xs)] text-gray-400 text-center">
                  Your manager will be notified.
                </div>
              </>
            ) : (
              <button
                onClick={() => void claim(false)}
                disabled={claiming}
                className={`${ds.btnPrimary} disabled:opacity-50`}
              >
                {claiming ? 'Taking…' : 'Take this shift'}
              </button>
            )}
            <button onClick={closeSheet} className={ds.btnSecondary}>
              {warn ? 'Never mind' : 'Cancel'}
            </button>
          </div>
        )}
      </Sheet>

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-base)] text-white shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
