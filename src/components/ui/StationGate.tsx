'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useShift } from '@/lib/shift-context';
import { useCompany } from '@/lib/company-context';

/**
 * StationGate — the shared kitchen tablet's front door. Active ONLY on a
 * station account (is_shared_device); renders nothing on personal logins.
 *
 * - Signed OUT: a full-screen PIN pad blocks the whole app. Typing a 4-digit
 *   PIN identifies the person (POST /api/station/pin-login) and marks them as
 *   "acting" so their work is credited to them. The tablet's own access stays
 *   kitchen-only, so a PIN never exposes HR/pay/admin.
 * - Signed IN: a slim bar with "Done" (sign out now) + an idle timer that signs
 *   out after a few minutes untouched. Last-activity is persisted so the idle
 *   window survives a reload — a tablet left overnight expires the operator
 *   instead of restoring them.
 */

const IDLE_MS = 3 * 60 * 1000;                 // auto sign-out after ~3 idle minutes
const LS_ACT = 'kw_station_last_activity';     // persisted so idle survives reloads
const LS_CO = 'kw_station_company';            // company the actor PIN'd into (survives reloads)

export default function StationGate({ serverShared }: { serverShared: boolean }) {
  const { activePerson, signIn, signOut } = useShift();
  const { companyId, companyName } = useCompany();
  const pathname = usePathname();
  // Seed from the server-derived flag: authoritative, instant, no Odoo — so we
  // never blank the portal waiting on a lookup, nor fail open on an "unknown".
  const [isShared, setIsShared] = useState<boolean>(serverShared);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const signedInCompany = useRef<number | null>(null); // company the actor PIN'd into

  // Sign out AND drop the persisted activity stamp + company binding. Used by
  // Done, idle expiry, tablet logout and company switch.
  const endSession = useCallback(() => {
    signedInCompany.current = null;
    try { localStorage.removeItem(LS_ACT); localStorage.removeItem(LS_CO); } catch { /* ignore */ }
    signOut();
  }, [signOut]);

  // The acting person only exists while this is a live station session. If the
  // station status drops to false for ANY reason (tablet logout via serverShared,
  // personal device), clear the actor so a later station login can't inherit the
  // previous person and skip the PIN gate.
  useEffect(() => {
    if (!isShared && activePerson) endSession();
  }, [isShared, activePerson, endSession]);

  // Honour later server-derived values. Login does router.refresh(), which
  // re-runs the server layout and passes a fresh serverShared — pick it up so
  // the gate engages after a station account signs in via client-side nav
  // (and doesn't depend on the session-flags request succeeding).
  useEffect(() => { setIsShared(serverShared); }, [serverShared]);

  // Re-check on navigation via the tiny session-only endpoint (no Odoo).
  //  - 200            → trust the flag
  //  - 401 logged out → clear the acting person too, else it could be restored
  //                     under the NEXT station login and bypass the PIN
  //  - 5xx / network  → keep last-known (never downgrade a known station to open)
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session-flags')
      .then(async r => {
        if (!alive) return;
        if (r.status === 401) { setIsShared(false); endSession(); return; }
        if (!r.ok) return; // transient — keep last-known
        const d = await r.json();
        setIsShared(!!d.is_shared_device);
      })
      .catch(() => { /* network error — keep last-known */ });
    return () => { alive = false; };
  }, [pathname, endSession]);

  // Bind the acting person to the restaurant they signed into: if the tablet's
  // company changes, sign them out so the next person PINs in for that company.
  useEffect(() => {
    if (activePerson && signedInCompany.current != null && companyId !== signedInCompany.current) {
      endSession();
    }
  }, [companyId, activePerson, endSession]);

  // While the PIN lock is up, make the rest of the app genuinely non-interactive
  // (not merely covered) so it can't be reached by keyboard or screen reader.
  useEffect(() => {
    const shell = typeof document !== 'undefined' ? document.getElementById('kw-app-shell') : null;
    if (!shell) return;
    if (isShared && !activePerson) shell.setAttribute('inert', '');
    else shell.removeAttribute('inert');
    return () => shell.removeAttribute('inert');
  }, [isShared, activePerson]);

  // Idle auto sign-out — only while signed in on a shared device.
  const lastActivity = useRef<number>(0);
  useEffect(() => {
    if (!isShared || !activePerson) return;
    // A fresh PIN sign-in already bound the company in-memory (storage-independent).
    // If it's null here, this actor was RESTORED from storage on reload.
    const restored = signedInCompany.current == null;
    if (restored) {
      let co = 0;
      try { co = Number(localStorage.getItem(LS_CO) || 0); } catch { co = 0; }
      if (!co) { endSession(); return; } // no persisted company binding → force re-PIN
      signedInCompany.current = co;
    }
    if (companyId && companyId !== signedInCompany.current) { endSession(); return; }
    // Reload-safe idle expiry: expire if the last activity was over the window ago.
    let persisted = 0;
    try { persisted = Number(localStorage.getItem(LS_ACT) || 0); } catch { persisted = 0; }
    // A restored actor with no valid activity stamp can't be aged safely → re-PIN.
    if (restored && !persisted) { endSession(); return; }
    if (persisted && Date.now() - persisted >= IDLE_MS) { endSession(); return; }
    lastActivity.current = persisted || Date.now();
    try { localStorage.setItem(LS_ACT, String(lastActivity.current)); } catch { /* ignore */ }

    const bump = () => {
      const t = Date.now();
      lastActivity.current = t;
      try { localStorage.setItem(LS_ACT, String(t)); } catch { /* ignore */ }
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_MS) endSession();
    }, 15000);
    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [isShared, activePerson, companyId, endSession]);

  const submit = useCallback(async (finalPin: string) => {
    if (finalPin.length !== 4) return;
    if (!companyId) { setErr('Just a moment — setting up…'); setPin(''); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/station/pin-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: finalPin, company_id: companyId }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        signedInCompany.current = companyId; // bind actor to the restaurant they verified against
        try { localStorage.setItem(LS_ACT, String(Date.now())); localStorage.setItem(LS_CO, String(companyId)); } catch { /* ignore */ }
        signIn({ id: d.user.id, name: d.user.name, employee_id: d.user.employee_id ?? null });
        setPin('');
      } else {
        setErr(d.error || 'PIN not recognised.'); setPin('');
      }
    } catch {
      setErr('Connection failed.'); setPin('');
    } finally {
      setBusy(false);
    }
  }, [companyId, signIn]);

  // Auto-submit on the 4th digit. (Intentionally only depends on `pin`.)
  useEffect(() => {
    if (pin.length === 4) submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const tapDigit = useCallback((d: string) => { setErr(''); setPin(p => (p.length >= 4 ? p : p + d)); }, []);

  if (!isShared) return null; // personal device → no gate

  // Signed in → slim status bar with Done.
  if (activePerson) {
    return (
      <div className="w-full flex items-center gap-2 px-4 py-2 bg-[#1A1F2E] text-white text-[13px]">
        <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
        <span>Signed in as <b className="font-bold">{activePerson.name}</b></span>
        <button onClick={endSession} className="ml-auto px-3 py-1 rounded-md bg-white/10 text-white/90 text-[12px] font-semibold active:bg-white/20">Done</button>
      </div>
    );
  }

  // Signed out → full-screen PIN lock over the whole app.
  return (
    <div className="fixed inset-0 z-[200] bg-[#1A1F2E] flex flex-col items-center justify-center px-6 text-white">
      <div className="text-center">
        <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-white/50">Kitchen Station</div>
        <div className="text-[var(--fs-xl)] font-bold mt-1">{companyName || 'Staff sign-in'}</div>
        <div className="text-[var(--fs-sm)] text-white/60 mt-1">Enter your PIN to start</div>
      </div>

      <div className="flex items-center justify-center gap-3 my-6">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full transition-colors ${i < pin.length ? 'bg-white' : 'bg-white/20'}`} />
        ))}
      </div>

      <div className="text-[14px] text-red-300 font-semibold mb-4 min-h-[20px]">{err}</div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-[300px]">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <button key={d} disabled={busy} onClick={() => tapDigit(d)}
            className="h-16 rounded-2xl bg-white/10 text-[26px] font-bold active:bg-white/20 disabled:opacity-50">{d}</button>
        ))}
        <div />
        <button disabled={busy} onClick={() => tapDigit('0')}
          className="h-16 rounded-2xl bg-white/10 text-[26px] font-bold active:bg-white/20 disabled:opacity-50">0</button>
        <button onClick={() => setPin(p => p.slice(0, -1))}
          className="h-16 rounded-2xl text-white/70 active:bg-white/10 flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><path d="M18 9l-6 6M12 9l6 6"/></svg>
        </button>
      </div>
    </div>
  );
}
