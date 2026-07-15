'use client';

import React, { useState } from 'react';

interface Company { id: number; name: string }

/**
 * Manager-only setup for a shared tablet. Enter a manager login → pick the
 * restaurant → the device is provisioned (PIN-only login from then on). If the
 * device is already a tablet, offers to remove the setup.
 *
 * `alreadyProvisioned` toggles the "remove setup" affordance. onDone reloads.
 */
export default function TabletSetup({ alreadyProvisioned, onDone, onCancel }: {
  alreadyProvisioned: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'setup' | 'remove'>('setup');

  async function verifyAndListCompanies() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/tablet/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await res.json();
      if (res.ok && d.step === 'pick') setCompanies(d.companies || []);
      else setError(d.error || 'Sign-in failed.');
    } catch { setError('Could not connect.'); } finally { setBusy(false); }
  }

  async function provision(companyId: number) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/tablet/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, company_id: companyId }),
      });
      const d = await res.json();
      if (res.ok && d.step === 'done') onDone();
      else setError(d.error || 'Setup failed.');
    } catch { setError('Could not connect.'); } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/tablet/deprovision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = await res.json();
      if (res.ok && d.ok) onDone();
      else setError(d.error || 'Failed.');
    } catch { setError('Could not connect.'); } finally { setBusy(false); }
  }

  const input = 'w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-all';
  const label = 'block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5';

  return (
    <div className="flex-1 px-6 py-8">
      <button onClick={onCancel} className="text-[13px] text-gray-500 font-semibold mb-4 active:opacity-70">&larr; Back</button>
      <h2 className="text-[20px] font-bold text-gray-900 mb-1">
        {mode === 'remove' ? 'Remove tablet setup' : 'Set up this tablet'}
      </h2>
      <p className="text-[13px] text-gray-500 mb-6">
        {mode === 'remove'
          ? 'A manager confirms to turn this back into a normal login.'
          : companies
            ? 'Pick the restaurant this tablet belongs to.'
            : 'A manager signs in once, then staff use only a PIN.'}
      </p>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">{error}</div>}

      {!companies ? (
        <div className="flex flex-col gap-4">
          <div>
            <label className={label}>Manager email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className={input} />
          </div>
          <div>
            <label className={label}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" className={input} />
          </div>
          <button
            onClick={() => (mode === 'remove' ? remove() : verifyAndListCompanies())}
            disabled={busy || !email || !password}
            className="w-full h-14 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 mt-2 flex items-center justify-center"
          >
            {busy ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (mode === 'remove' ? 'Remove setup' : 'Continue')}
          </button>

          {alreadyProvisioned && mode === 'setup' && (
            <button onClick={() => { setMode('remove'); setError(null); }} className="text-[13px] text-red-600 font-semibold mt-1 active:opacity-70">
              Remove this tablet setup instead
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {companies.length === 0 && <div className="text-[13px] text-gray-400 py-4">No restaurants available for your account.</div>}
          {companies.map(c => (
            <button key={c.id} onClick={() => provision(c.id)} disabled={busy}
              className="w-full flex items-center justify-between px-4 py-4 rounded-xl border border-gray-200 text-left active:bg-gray-50 disabled:opacity-50">
              <span className="text-[15px] font-semibold text-gray-900">{c.name}</span>
              <span className="text-green-600 text-[13px] font-bold">Set up &rarr;</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
