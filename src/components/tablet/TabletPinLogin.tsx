'use client';

import React, { useState } from 'react';
import PinPad from './PinPad';

/** The provisioned tablet's login: a PIN pad. A correct PIN signs the tablet in
 *  as the person and lands on the Kitchen Station home. */
export default function TabletPinLogin({ companyName, onManager }: { companyName: string; onManager: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(pin: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/tablet/pin-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        // Seed the acting person + StationGate keys DIRECTLY in localStorage (not via
        // ShiftProvider.signIn): on the /login page StationGate has isShared=false, so
        // reactively setting an active person there would trip its "not a shared
        // device -> clear the actor" effect and sign the person straight back out.
        // Writing storage and hard-navigating lets StationGate restore + accept the
        // person on the home, where isShared=true.
        try {
          const person = { id: d.user.id, name: d.user.name, employee_id: d.user.employee_id ?? null, since: Date.now() };
          localStorage.setItem('kw_active_person', JSON.stringify(person));
          localStorage.setItem('kw_station_company', String(d.company_id));
          localStorage.setItem('kw_station_last_activity', String(Date.now()));
        } catch { /* storage disabled */ }
        window.location.assign('/');
      } else {
        setError(d.error || 'PIN not recognised.');
        setBusy(false);
      }
    } catch {
      setError('Connection failed.');
      setBusy(false);
    }
  }

  return (
    <PinPad
      title={companyName || 'Staff sign-in'}
      subtitle="Enter your PIN to start"
      error={error}
      busy={busy}
      onSubmit={submit}
      footer={
        <button onClick={onManager} className="text-white/40 text-[12px] font-semibold active:text-white/70">
          Manager setup
        </button>
      }
    />
  );
}
