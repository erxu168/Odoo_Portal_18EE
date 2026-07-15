'use client';

import React, { useState } from 'react';
import { useShift } from '@/lib/shift-context';
import PinPad from './PinPad';

/** The provisioned tablet's login: a PIN pad. A correct PIN signs the tablet in
 *  as the person and lands on the Kitchen Station home. */
export default function TabletPinLogin({ companyName, onManager }: { companyName: string; onManager: () => void }) {
  const { signIn } = useShift();
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
        // Remember the acting person for the UI bar, then HARD-navigate so the
        // company context + server layout re-initialise from the new session
        // (a soft push leaves companyId=0, showing empty company-scoped screens).
        signIn({ id: d.user.id, name: d.user.name, employee_id: d.user.employee_id ?? null });
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
