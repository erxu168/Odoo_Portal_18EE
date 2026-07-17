'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useShift } from '@/lib/shift-context';
import { useCompany } from '@/lib/company-context';
import StationSignIn from '@/components/station/StationSignIn';

/**
 * StationGate — the shared kitchen tablet's front door. Active ONLY on a
 * station account (is_shared_device); renders nothing on personal logins.
 *
 * - Signed OUT: a full-screen name-then-PIN sign-in blocks the whole app. You tap
 *   your name and enter your 4-digit PIN (POST /api/station/pin-login), which marks
 *   you as "acting" so your work is credited to you. The tablet's own access stays
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
  const signedInCompany = useRef<number | null>(null); // company the actor PIN'd into

  // Sign out AND drop the persisted activity stamp + company binding. Used by
  // Done, idle expiry, tablet logout and company switch. Also tells the server to
  // delete the acting token + clear the httpOnly cookie (fire-and-forget; the
  // token is station-bound and expires regardless).
  const endSession = useCallback(() => {
    signedInCompany.current = null;
    try { localStorage.removeItem(LS_ACT); localStorage.removeItem(LS_CO); } catch { /* ignore */ }
    fetch('/api/station/sign-out', { method: 'POST', keepalive: true }).catch(() => {});
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

  // Load this restaurant's pickable staff (session-authed; the station account is
  // already signed in here, unlike the pre-session /login screen).
  const loadStaff = useCallback(async () => {
    if (!companyId) return [];
    const r = await fetch(`/api/shift/staff?company_id=${companyId}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('load failed');
    const d = await r.json();
    return Array.isArray(d.staff) ? d.staff : [];
  }, [companyId]);

  // Verify the chosen person's PIN. Company comes from the tablet, not the picker.
  const verify = useCallback(async (userId: number, pin: string) => {
    if (!companyId) return { ok: false, error: 'Just a moment — setting up…' };
    const res = await fetch('/api/station/pin-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, company_id: companyId, pin }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok && d.ok ? { ok: true, user: d.user } : { ok: false, error: d.error };
  }, [companyId]);

  const onSignedIn = useCallback((user: { id: number; name: string; employee_id: number | null }) => {
    signedInCompany.current = companyId ?? null; // bind actor to the restaurant they verified against
    try { localStorage.setItem(LS_ACT, String(Date.now())); if (companyId) localStorage.setItem(LS_CO, String(companyId)); } catch { /* ignore */ }
    signIn({ id: user.id, name: user.name, employee_id: user.employee_id ?? null });
  }, [companyId, signIn]);

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

  // Signed out → full-screen name-then-PIN sign-in over the whole app.
  return (
    <StationSignIn
      companyName={companyName}
      loadStaff={loadStaff}
      verify={verify}
      onSuccess={onSignedIn}
    />
  );
}
