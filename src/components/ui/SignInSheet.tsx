'use client';

import React, { useEffect, useState } from 'react';
import { useCompany } from '@/lib/company-context';

interface StaffOption { id: number; name: string; }

interface Props {
  open: boolean;
  activePerson: { id: number; name: string } | null;
  onClose: () => void;
  onSignedIn: (p: { id: number; name: string; employee_id: number | null }) => void;
  onSignOut: () => void;
}

/**
 * Bottom-sheet name picker + 4-digit PIN pad for shared devices. Presentation
 * only — it holds no "who's active" state itself; the ShiftProvider owns that
 * and drives this via props, so the same sheet serves both the "Working as"
 * banner and any "prompt when it matters" gate (e.g. before opening Tasks).
 */
export default function SignInSheet({ open, activePerson, onClose, onSignedIn, onSignOut }: Props) {
  const { companyId } = useCompany();
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [picked, setPicked] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // (Re)load the staff picker each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setPicked(null); setPin(''); setErr('');
    if (companyId) {
      fetch(`/api/shift/staff?company_id=${companyId}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) setStaff(d.staff || []); })
        .catch(() => { /* offline — show empty state */ });
    }
  }, [open, companyId]);

  function tapDigit(d: string) {
    setErr('');
    setPin(prev => (prev.length >= 4 ? prev : prev + d));
  }

  async function submitPin(finalPin: string) {
    if (!picked || finalPin.length !== 4) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/shift/identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: picked.id, pin: finalPin }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        onSignedIn({ id: d.user.id, name: d.user.name, employee_id: d.user.employee_id ?? null });
      } else {
        setErr(d.error || 'Wrong PIN'); setPin('');
      }
    } catch {
      setErr('Connection failed'); setPin('');
    } finally {
      setBusy(false);
    }
  }

  // Auto-submit when the 4th digit is entered.
  useEffect(() => { if (picked && pin.length === 4) submitPin(pin); /* eslint-disable-next-line */ }, [pin]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full bg-white rounded-t-3xl px-5 pt-5 pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {!picked ? (
          <>
            <div className="text-center mb-4">
              <div className="text-[17px] font-bold text-gray-900">Who&rsquo;s working?</div>
              <div className="text-[12px] text-gray-500 mt-0.5">Pick your name to log your work to you</div>
            </div>
            {activePerson && (
              <button onClick={onSignOut}
                className="w-full mb-3 py-3 rounded-xl border border-red-200 text-red-600 text-[14px] font-semibold active:bg-red-50">
                Sign out {activePerson.name}
              </button>
            )}
            <div className="flex flex-col gap-2">
              {staff.length === 0 && (
                <div className="text-center py-6 text-[13px] text-gray-400">No staff have a PIN yet. An admin sets PINs in Manage Staff.</div>
              )}
              {staff.map(s => (
                <button key={s.id} onClick={() => { setPicked(s); setPin(''); setErr(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 text-left active:bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-[#F1F3F5] flex items-center justify-center text-[13px] font-bold text-gray-600">
                    {s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <span className="text-[14px] font-semibold text-gray-900">{s.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-4">
              <div className="text-[17px] font-bold text-gray-900">{picked.name}</div>
              <div className="text-[12px] text-gray-500 mt-0.5">Enter your 4-digit PIN</div>
            </div>
            <div className="flex items-center justify-center gap-3 mb-5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-[#2563EB]' : 'bg-gray-200'}`} />
              ))}
            </div>
            {err && <div className="text-center text-[13px] text-red-600 font-semibold mb-3">{err}</div>}
            <div className="grid grid-cols-3 gap-2.5">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <button key={d} onClick={() => tapDigit(d)} disabled={busy}
                  className="h-14 rounded-xl bg-gray-100 text-[22px] font-bold text-gray-800 active:bg-gray-200">{d}</button>
              ))}
              <button onClick={() => setPicked(null)} className="h-14 rounded-xl text-[13px] font-semibold text-gray-500 active:bg-gray-100">Back</button>
              <button onClick={() => tapDigit('0')} disabled={busy} className="h-14 rounded-xl bg-gray-100 text-[22px] font-bold text-gray-800 active:bg-gray-200">0</button>
              <button onClick={() => setPin(p => p.slice(0, -1))} className="h-14 rounded-xl text-gray-500 active:bg-gray-100 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/></svg>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
