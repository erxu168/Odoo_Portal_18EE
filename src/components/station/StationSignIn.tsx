'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PinPad from '@/components/tablet/PinPad';

export interface StationPerson { id: number; name: string; employee_id: number | null }
export interface VerifyResult { ok: boolean; user?: StationPerson; error?: string }

interface Props {
  companyName: string;
  /** Load the pickable staff for this tablet's restaurant (throws on failure). */
  loadStaff: () => Promise<{ id: number; name: string }[]>;
  /** Verify the chosen person's PIN. Returns ok + the person, or an error message. */
  verify: (userId: number, pin: string) => Promise<VerifyResult>;
  /** Called once the chosen person's PIN is confirmed. */
  onSuccess: (user: StationPerson) => void;
  footer?: React.ReactNode;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

/**
 * Shared shared-tablet sign-in: TAP YOUR NAME, then enter your PIN — the same flow
 * as the clock-in kiosk. The name identifies the person, so two staff may safely
 * share a PIN (no reverse-by-PIN lookup, no "ambiguous" dead-end). Presentational +
 * flow only: the parent supplies loadStaff (which restaurant), verify (checks the
 * chosen person's PIN) and onSuccess (create the session/actor, then navigate).
 */
export default function StationSignIn({ companyName, loadStaff, verify, onSuccess, footer }: Props) {
  const [staff, setStaff] = useState<{ id: number; name: string }[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    let alive = true;
    // Reset any in-progress selection too: if the restaurant changed (loadStaff identity
    // changes), a name picked from the OLD roster must not carry into the new company.
    setStaff(null); setLoadFailed(false); setSelected(null); setError('');
    loadStaff()
      .then(list => { if (alive) setStaff(list); })
      .catch(() => { if (alive) { setStaff([]); setLoadFailed(true); } });
    return () => { alive = false; };
  }, [loadStaff]);

  useEffect(() => refresh(), [refresh]);

  const submitPin = useCallback(async (pin: string) => {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const r = await verify(selected.id, pin);
      if (r.ok) { onSuccess(r.user ?? { id: selected.id, name: selected.name, employee_id: null }); return; }
      setError(r.error || 'PIN not recognised.');
    } catch {
      setError('Connection failed.');
    } finally {
      setBusy(false);
    }
  }, [selected, busy, verify, onSuccess]);

  // Step 2 — the chosen person's PIN pad.
  if (selected) {
    return (
      <PinPad
        title={selected.name}
        subtitle="Enter your PIN"
        error={error}
        busy={busy}
        onSubmit={submitPin}
        footer={
          <button onClick={() => { setSelected(null); setError(''); }}
            className="text-white/50 text-[13px] font-semibold active:text-white/80">
            &larr; Not you? Pick a name
          </button>
        }
      />
    );
  }

  // Step 1 — pick your name.
  return (
    <div className="fixed inset-0 z-[200] bg-[#1A1F2E] flex flex-col text-white">
      <div className="px-6 pt-8 pb-4 text-center shrink-0">
        <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-white/50">Kitchen Station</div>
        <div className="text-[var(--fs-xl)] font-bold mt-1">{companyName || 'Staff sign-in'}</div>
        <div className="text-[var(--fs-sm)] text-white/60 mt-1">Tap your name to sign in</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {staff === null ? (
          <div className="text-center text-white/50 mt-10 text-[14px]">Loading&hellip;</div>
        ) : loadFailed ? (
          <div className="text-center mt-10">
            <div className="text-white/60 text-[14px] mb-3">Couldn&rsquo;t load the staff list.</div>
            <button onClick={refresh} className="px-4 py-2 rounded-xl bg-white/10 text-[14px] font-semibold active:bg-white/20">Try again</button>
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center text-white/60 mt-10 text-[14px] px-6 leading-relaxed">
            No one has set up a PIN yet.<br />Set yours on the Time Clock, or ask a manager.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-w-[520px] mx-auto">
            {staff.map(s => (
              <button key={s.id} onClick={() => { setSelected(s); setError(''); }}
                className="min-h-[64px] rounded-2xl bg-white/10 px-4 py-3 text-left active:bg-white/20 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-[13px] font-bold shrink-0">{initials(s.name)}</span>
                <span className="min-w-0 truncate text-[16px] font-semibold">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {footer && <div className="shrink-0 px-6 py-4 text-center border-t border-white/10">{footer}</div>}
    </div>
  );
}
