'use client';

import React, { useCallback, useRef } from 'react';
import StationSignIn, { StationPerson } from '@/components/station/StationSignIn';

/** The provisioned tablet's login: TAP YOUR NAME, then enter your PIN. A correct
 *  PIN signs the tablet in as that person and lands on the Kitchen Station home. */
export default function TabletPinLogin({ companyName, onManager }: { companyName: string; onManager: () => void }) {
  const companyIdRef = useRef<number | null>(null);

  const loadStaff = useCallback(async () => {
    const r = await fetch('/api/tablet/staff', { cache: 'no-store' });
    if (!r.ok) throw new Error('load failed');
    const d = await r.json();
    return Array.isArray(d.staff) ? d.staff : [];
  }, []);

  const verify = useCallback(async (userId: number, pin: string) => {
    const res = await fetch('/api/tablet/pin-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, pin }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) { companyIdRef.current = d.company_id ?? null; return { ok: true, user: d.user }; }
    return { ok: false, error: d.error };
  }, []);

  const onSuccess = useCallback((user: StationPerson) => {
    // Seed the acting person + StationGate keys DIRECTLY in localStorage (not via
    // ShiftProvider.signIn): on /login StationGate has isShared=false, so setting an
    // active person there would trip its "not a shared device -> clear actor" effect
    // and sign the person straight back out. Writing storage + hard-navigating lets
    // StationGate restore + accept the person on the home, where isShared=true.
    try {
      const person = { id: user.id, name: user.name, employee_id: user.employee_id ?? null, since: Date.now() };
      localStorage.setItem('kw_active_person', JSON.stringify(person));
      if (companyIdRef.current != null) localStorage.setItem('kw_station_company', String(companyIdRef.current));
      localStorage.setItem('kw_station_last_activity', String(Date.now()));
    } catch { /* storage disabled */ }
    window.location.assign('/');
  }, []);

  return (
    <StationSignIn
      companyName={companyName}
      loadStaff={loadStaff}
      verify={verify}
      onSuccess={onSuccess}
      footer={
        <button onClick={onManager} className="text-white/40 text-[12px] font-semibold active:text-white/70">
          Manager setup
        </button>
      }
    />
  );
}
