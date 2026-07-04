'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner } from '@/components/shifts/ui';

/**
 * Clock PIN — staff set their own 4-digit tablet-clock PIN (managers can also
 * set it in Roster). Enter + confirm, saved via POST /api/shifts/my-pin.
 */

interface MyPinProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

export default function MyPin({ companyId, onBack }: MyPinProps) {
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/shifts/my-pin?company_id=${companyId}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${r.status}`);
      setHasPin(d.hasPin === true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) load();
  }, [companyId, load]);

  async function save() {
    setSaveError(null);
    setSaved(false);
    if (!/^\d{4}$/.test(pin)) {
      setSaveError('Enter exactly 4 digits.');
      return;
    }
    if (pin !== confirm) {
      setSaveError('The two PINs don’t match.');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/shifts/my-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, pin }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${r.status}`);
      setSaved(true);
      setPin('');
      setConfirm('');
      setHasPin(true);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full max-w-[200px] bg-white border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-md)] font-bold text-gray-900 tracking-[0.5em] outline-none focus:border-green-600';
  const labelCls = 'block text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Clock PIN" showBack onBack={onBack} />
      <div className="px-4 pt-4 pb-24 max-w-md mx-auto">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Could not load</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5">{error}</p>
            <button onClick={load} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-sm)] text-gray-600 leading-relaxed mb-4">
              This is your personal 4-digit PIN for the tablet time clock.{' '}
              {hasPin ? 'You already have one — enter a new one to change it.' : 'Set one so you can clock in and out.'} Keep it
              private.
            </div>

            <label className={labelCls}>New PIN</label>
            <input
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              value={pin}
              onChange={e => setPin(onlyDigits(e.target.value))}
              placeholder="••••"
              className={`${inputCls} mb-4`}
            />

            <label className={labelCls}>Confirm PIN</label>
            <input
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              value={confirm}
              onChange={e => setConfirm(onlyDigits(e.target.value))}
              placeholder="••••"
              className={`${inputCls} mb-4`}
            />

            {saveError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700 mb-3">
                {saveError}
              </div>
            )}
            {saved && (
              <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-[var(--fs-sm)] text-green-700 mb-3">
                ✓ PIN saved.
              </div>
            )}

            <button
              onClick={save}
              disabled={saving}
              className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save PIN'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
