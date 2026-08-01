'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PinPad from '@/components/tablet/PinPad';
import { WAJ_RED, WAJ_YELLOW } from '@/components/kiosk/KioskWelcome';

/** Label colour for the yellow badges/buttons — matches the kiosk (6.9:1 on yellow). */
const WAJ_INK = '#5A0E16';

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
 *
 * Branded in the What a Jerk look (matches the Time Clock kiosk): deep red ground,
 * the WAJ logo, warm yellow name badges.
 */
export default function StationSignIn({ companyName, loadStaff, verify, onSuccess, footer }: Props) {
  const [staff, setStaff] = useState<{ id: number; name: string }[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A broken logo file must never leave a broken-image icon on the sign-in screen —
  // fall back to the wordmark set in type (same as the kiosk).
  const [logoFailed, setLogoFailed] = useState(false);

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

  // Step 2 — the chosen person's PIN pad (branded to match).
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
            className="text-white/60 text-[13px] font-semibold active:text-white">
            &larr; Not you? Pick a name
          </button>
        }
      />
    );
  }

  // Step 1 — pick your name.
  return (
    <div className="fixed inset-0 z-[200] flex flex-col text-white" style={{ backgroundColor: WAJ_RED }}>
      <div className="px-6 pt-6 pb-3 text-center shrink-0">
        {logoFailed ? (
          <div className="font-extrabold leading-none" style={{ color: WAJ_YELLOW }}>
            <div className="text-[clamp(28px,7vw,44px)]">What a Jerk</div>
            <div className="text-[10px] tracking-[0.28em] mt-1.5">TRUE JAMAICAN FLAVOURS</div>
          </div>
        ) : (
          <img
            src="/waj-logo.svg"
            alt="What a Jerk"
            onError={() => setLogoFailed(true)}
            className="mx-auto w-[min(52vw,220px)] max-h-[20vh] object-contain"
          />
        )}
        <div className="text-[var(--fs-lg)] font-bold text-white mt-3">{companyName || 'Staff sign-in'}</div>
        <div className="text-[var(--fs-sm)] text-white/75 mt-0.5">Tap your name to sign in</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {staff === null ? (
          <div className="text-center text-white/60 mt-10 text-[14px]">Loading&hellip;</div>
        ) : loadFailed ? (
          <div className="text-center mt-10">
            <div className="text-white/75 text-[14px] mb-3">Couldn&rsquo;t load the staff list.</div>
            <button onClick={refresh} className="px-5 py-2.5 min-h-[44px] rounded-xl text-[14px] font-bold active:brightness-110"
              style={{ backgroundColor: WAJ_YELLOW, color: WAJ_INK }}>Try again</button>
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center text-white/75 mt-10 text-[14px] px-6 leading-relaxed">
            No one has set up a PIN yet.<br />Set yours on the Time Clock, or ask a manager.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-w-[520px] mx-auto auto-rows-fr">
            {staff.map(s => (
              <button key={s.id} onClick={() => { setSelected(s); setError(''); }}
                className="h-full min-h-[64px] rounded-2xl px-4 py-3 text-left border border-white/15 flex items-center gap-3 active:brightness-110 transition"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-extrabold shrink-0"
                  style={{ backgroundColor: WAJ_YELLOW, color: WAJ_INK }}>{initials(s.name)}</span>
                <span className="min-w-0 text-[15px] font-semibold leading-tight break-words">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {footer && <div className="shrink-0 px-6 py-4 text-center border-t border-white/15">{footer}</div>}
    </div>
  );
}
