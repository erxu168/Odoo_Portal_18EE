'use client';

import React, { useEffect, useState } from 'react';
import { useShift } from '@/lib/shift-context';
import { useCompany } from '@/lib/company-context';

interface StaffOption { id: number; name: string; }

/**
 * Shown only on a "Shared device" account. Lets whoever is using the shared
 * tablet identify themselves (name + 4-digit PIN) so their work is credited to
 * them. Stays as that person until they switch or 12h pass.
 */
export default function WorkingAsBanner() {
  const { activePerson, signIn, signOut } = useShift();
  const { companyId } = useCompany();
  const [isShared, setIsShared] = useState(false);
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [picked, setPicked] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.is_shared_device) setIsShared(true); }).catch(() => {});
  }, []);

  async function openSheet() {
    setOpen(true); setPicked(null); setPin(''); setErr('');
    if (companyId) {
      try { const res = await fetch(`/api/shift/staff?company_id=${companyId}`); if (res.ok) { const d = await res.json(); setStaff(d.staff || []); } } catch { /* */ }
    }
  }

  function tapDigit(d: string) {
    setErr('');
    setPin(prev => (prev.length >= 4 ? prev : prev + d));
  }

  async function submitPin(finalPin: string) {
    if (!picked || finalPin.length !== 4) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/shift/identify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: picked.id, pin: finalPin }),
      });
      const d = await res.json();
      if (res.ok && d.ok) { signIn({ id: d.user.id, name: d.user.name, employee_id: d.user.employee_id ?? null }); setOpen(false); }
      else { setErr(d.error || 'Wrong PIN'); setPin(''); }
    } catch { setErr('Connection failed'); setPin(''); } finally { setBusy(false); }
  }

  // Auto-submit when the 4th digit is entered.
  useEffect(() => { if (picked && pin.length === 4) submitPin(pin); /* eslint-disable-next-line */ }, [pin]);

  if (!isShared) return null;

  return (
    <>
      <button onClick={openSheet} className="w-full flex items-center gap-2 px-4 py-2 bg-[#1A1F2E] text-white text-[13px] active:bg-[#232838]">
        <span className={`w-2 h-2 rounded-full ${activePerson ? 'bg-[#16A34A]' : 'bg-amber-400 animate-pulse'}`} />
        {activePerson
          ? <span>Working as <b className="font-bold">{activePerson.name}</b></span>
          : <span className="text-amber-300 font-semibold">Tap to sign in for your shift</span>}
        <span className="ml-auto text-white/50 text-[12px] font-semibold">{activePerson ? 'Switch' : 'Sign in'}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full bg-white rounded-t-3xl px-5 pt-5 pb-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {!picked ? (
              <>
                <div className="text-center mb-4">
                  <div className="text-[17px] font-bold text-gray-900">Who&rsquo;s working?</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">Pick your name to log your work to you</div>
                </div>
                {activePerson && (
                  <button onClick={() => { signOut(); setOpen(false); }}
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
      )}
    </>
  );
}
