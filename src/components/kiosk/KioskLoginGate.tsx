'use client';

import React, { useState } from 'react';

export interface KioskCompany {
  id: number;
  name: string;
}

interface Props {
  onUnlock: (companies: KioskCompany[], managerName: string) => void;
  onClose: () => void;
}

/**
 * Manager/admin sign-in that unlocks the kiosk settings. Posts email + password
 * to /api/kiosk/admin-login. Never stores the password; on success it hands the
 * caller the companies the manager may configure. No portal session is created.
 */
export default function KioskLoginGate({ onUnlock, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/kiosk/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        onUnlock(Array.isArray(d.companies) ? d.companies : [], typeof d.name === 'string' ? d.name : '');
      } else {
        setError(typeof d.error === 'string' ? d.error : 'Sign-in failed — try again.');
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🔒</div>
          <div className="text-xl font-extrabold text-gray-900">Manager sign-in</div>
          <div className="text-gray-500 font-medium mt-1">Only managers and admins can change tablet settings.</div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full h-14 px-4 rounded-2xl border border-gray-200 bg-white text-lg text-gray-900 outline-none focus:border-green-600"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full h-14 px-4 rounded-2xl border border-gray-200 bg-white text-lg text-gray-900 outline-none focus:border-green-600"
          />
          <div className="h-5 text-center">{error && <span className="text-red-600 font-bold text-sm">{error}</span>}</div>
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-bold active:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Checking…' : 'Unlock settings'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full h-12 rounded-2xl text-gray-500 font-semibold active:bg-gray-100"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
