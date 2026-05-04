'use client';

import React, { useEffect, useState } from 'react';

interface ShelfLifeCardProps {
  productTmplId: number;
  canEdit: boolean; // parent (BomDetail) decides this from the user role
}

interface ShelfLifeValues {
  chilled_days: number;
  frozen_days: number;
}

export default function ShelfLifeCard({ productTmplId, canEdit }: ShelfLifeCardProps) {
  const [values, setValues] = useState<ShelfLifeValues | null>(null);
  const [chilledInput, setChilledInput] = useState('');
  const [frozenInput, setFrozenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/products/${productTmplId}/shelf-life`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Failed to load shelf life');
          return;
        }
        setValues(data);
        setChilledInput(data.chilled_days ? String(data.chilled_days) : '');
        setFrozenInput(data.frozen_days ? String(data.frozen_days) : '');
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load shelf life');
      }
    })();
    return () => { cancelled = true; };
  }, [productTmplId]);

  function parseDays(input: string): number | null {
    const trimmed = input.trim();
    if (trimmed === '') return 0;
    const n = parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 0 || n > 999 || String(n) !== trimmed) return null;
    return n;
  }

  async function handleSave() {
    const chilled = parseDays(chilledInput);
    const frozen = parseDays(frozenInput);
    if (chilled === null || frozen === null) {
      setError('Each value must be a whole number between 0 and 999.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productTmplId}/shelf-life`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chilled_days: chilled, frozen_days: frozen }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Save failed');
        return;
      }
      setValues(data);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!values) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
        <div className="text-sm text-gray-400">Loading shelf life...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
      <div className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-3">
        Shelf Life
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="text-[11px] font-bold tracking-wider uppercase text-gray-400 block mb-1">
            Chilled
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={chilledInput}
              onChange={e => setChilledInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
              className="w-20 h-12 px-3 border-[1.5px] border-gray-200 rounded-lg bg-gray-50 text-center text-base font-semibold focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/15 disabled:opacity-60"
            />
            <span className="text-sm text-gray-500">days</span>
          </div>
          {(parseDays(chilledInput) === 0) && (
            <div className="text-xs text-gray-400 mt-1">Not set — labels will print with no expiry date.</div>
          )}
        </div>

        <div className="flex-1">
          <label className="text-[11px] font-bold tracking-wider uppercase text-gray-400 block mb-1">
            Frozen
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={frozenInput}
              onChange={e => setFrozenInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
              className="w-20 h-12 px-3 border-[1.5px] border-gray-200 rounded-lg bg-gray-50 text-center text-base font-semibold focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/15 disabled:opacity-60"
            />
            <span className="text-sm text-gray-500">days</span>
          </div>
          {(parseDays(frozenInput) === 0) && (
            <div className="text-xs text-gray-400 mt-1">Not set — labels will print with no expiry date.</div>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-3">
        Used to calculate the expiry date when printing labels.
      </div>

      {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

      {canEdit && (
        <div className="mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 active:scale-[0.97] text-white font-semibold rounded-full px-5 h-10 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save shelf life'}
          </button>
          {savedToast && (
            <span className="ml-3 text-sm text-green-600">Shelf life updated. New labels will use these values.</span>
          )}
        </div>
      )}
    </div>
  );
}
