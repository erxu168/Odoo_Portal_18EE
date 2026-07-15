'use client';

import React, { useEffect, useState } from 'react';

/**
 * Public "set a new Time Clock PIN" page, opened on the staff member's own phone
 * from the reset link they were emailed (/kiosk/reset-pin?token=…). They choose a
 * new 4-digit PIN (enter + confirm); it posts to /api/kiosk/reset with the token.
 * The token (not a login) authorises the change.
 */
export default function KioskResetPinPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    if (pin !== confirm) {
      setError('The two PINs don’t match.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/kiosk/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setDone(true);
      } else {
        setError(d.error || 'Could not set your PIN. The link may have expired.');
      }
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full text-center text-3xl font-bold tracking-[0.4em] tabular-nums bg-gray-50 border border-gray-200 rounded-2xl py-4 outline-none focus:border-green-500';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-sm border border-gray-100 p-7">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🕒</div>
          <div className="text-xl font-extrabold text-gray-900">Set a new PIN</div>
          <div className="text-gray-500 text-sm mt-1">Choose a 4-digit PIN for the time clock.</div>
        </div>

        {done ? (
          <div className="text-center">
            <div className="text-5xl mb-3">✅</div>
            <div className="text-lg font-bold text-gray-900">Your PIN is set</div>
            <div className="text-gray-500 mt-1">Go back to the tablet and tap your name to clock in.</div>
          </div>
        ) : token === null ? (
          <div className="text-center text-gray-500">Loading…</div>
        ) : token === '' ? (
          <div className="text-center text-red-600 font-semibold">This link is missing its reset code. Please use the link from your email.</div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">New PIN</label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className={inputCls}
                placeholder="••••"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Confirm PIN</label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={confirm}
                onChange={e => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className={inputCls}
                placeholder="••••"
              />
            </div>
            {error && <div className="text-red-600 font-semibold text-sm text-center">{error}</div>}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 bg-green-600 text-white py-4 rounded-2xl text-lg font-bold active:bg-green-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save PIN'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
