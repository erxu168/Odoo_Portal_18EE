'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { pluralizePack } from '@/lib/crate-units';

/**
 * The packaging CHAIN for one product: box -> pack -> piece.
 *
 * The sentence above this ("1 crate = 24 bottles") sets the OUTER pack, which is
 * what counting uses today. This adds the levels INSIDE it, for products that
 * really nest — a box of 30 buns holding three sealed 10-packs — so staff can
 * count "2 boxes + 1 sealed pack + 4 loose" instead of doing the sum in their head.
 *
 * Storage + validation live behind /api/inventory/products/[id]/packaging; the
 * arithmetic is src/lib/packaging.ts. This screen only edits.
 */

interface LevelRow {
  /** Stable client key so removing an unsaved row can't move focus onto another. */
  key: string;
  id: number | null;
  name: string;
  to_base: number | string;
}

let seq = 0;
const newKey = () => `new-${++seq}`;

export default function PackagingLevels({ productId, baseWord, readOnly = false }: {
  productId: number;
  /** What one base unit is called ("pieces", "bottles", "kg"). */
  baseWord: string;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<LevelRow[]>([]);
  const [chain, setChain] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // PUT replaces the WHOLE chain, so editing must stay locked until we have
  // actually seen what is stored — otherwise a failed load leaves an empty
  // editor that can erase levels the manager never saw.
  const [loaded, setLoaded] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqRef.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/inventory/products/${productId}/packaging`);
      if (!r.ok) throw new Error('load');
      const d = await r.json();
      if (token !== reqRef.current) return;      // a newer load won
      setRows((d.levels || []).map((l: { id: number; name: string; to_base: number }) => (
        { key: `id-${l.id}`, id: l.id, name: l.name, to_base: l.to_base }
      )));
      setChain(d.chain || '');
      setError(null);
      setLoaded(true);
      setDirty(false);
    } catch {
      if (token !== reqRef.current) return;
      setError('Could not load the packaging.');
      setLoaded(false);
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, [productId]);   // NOT baseWord: that is only a display word, and reloading
                     // on it threw away unsaved rows while the loose label was typed

  useEffect(() => { load(); }, [load]);

  const locked = readOnly || saving || !loaded;

  function edit(i: number, patch: Partial<LevelRow>) {
    if (locked) return;
    setRows((prev) => prev.map((r, x) => (x === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function addRow() {
    if (locked) return;
    setRows((prev) => [...prev, { key: newKey(), id: null, name: '', to_base: '' }]);
    setDirty(true);
  }
  function removeRow(i: number) {
    if (locked) return;
    setRows((prev) => prev.filter((_, x) => x !== i));
    setDirty(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const kept = rows.filter((r) => (r.name || '').trim() !== '' || String(r.to_base).trim() !== '');
      // Parse STRICTLY. Stripping "everything but digits and dots" turned a German
      // 2,5 into 25 and 1e3 into 13 — both valid numbers afterwards, so no server
      // check could ever catch the change. A comma is read as a decimal point.
      for (const r of kept) {
        const raw = String(r.to_base).trim().replace(',', '.');
        if (!/^\d*\.?\d+$/.test(raw)) {
          setError(`“${(r.name || 'that level').trim()}” has a size that is not a plain number.`);
          return;
        }
      }
      const payload = kept.map((r) => ({
        id: r.id,
        name: (r.name || '').trim(),
        to_base: Number(String(r.to_base).trim().replace(',', '.')),
      }));
      const res = await fetch(`/api/inventory/products/${productId}/packaging`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levels: payload }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server explains exactly what is wrong with the chain — show that,
        // never a generic failure, because the manager has to fix it.
        setError(d.error || 'Could not save the packaging.');
        return;
      }
      setDirty(false);
      await load();
    } catch {
      setError('Network error — not saved.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[var(--fs-sm)] font-bold text-gray-700">Inside the pack</span>
        <span className="text-[var(--fs-xs)] text-gray-400">optional</span>
      </div>
      <p className="text-[var(--fs-xs)] text-gray-500 mb-2.5">
        Only for products that nest — a box holding sealed packs. Say what one of each is worth in {baseWord || 'units'}.
      </p>

      {rows.length === 0 ? (
        <p className="text-[var(--fs-xs)] text-gray-400 mb-2">No inner levels — this product is counted in one pack size.</p>
      ) : (
        <div className="flex flex-col gap-2 mb-2">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[var(--fs-sm)] font-semibold text-gray-500">1</span>
              <input value={r.name} disabled={locked}
                onChange={(e) => edit(i, { name: e.target.value.slice(0, 20) })}
                placeholder="box"
                aria-label={`Level ${i + 1} name`}
                className="w-28 h-9 border border-gray-300 rounded-lg px-2 text-[var(--fs-sm)] font-semibold" />
              <span className="text-[var(--fs-sm)] font-semibold text-gray-500">=</span>
              <input value={String(r.to_base)} disabled={locked}
                onChange={(e) => edit(i, { to_base: e.target.value })}
                inputMode="decimal" placeholder="30"
                aria-label={`How many ${baseWord || 'units'} in one ${(r.name || `level ${i + 1}`)}`}
                className="w-20 h-9 border border-gray-300 rounded-lg text-center font-mono font-semibold" />
              <span className="text-[var(--fs-sm)] text-gray-400">{baseWord || 'units'}</span>
              {!readOnly && (
                <button onClick={() => removeRow(i)} disabled={locked} aria-label={`Remove ${r.name || 'this level'}`}
                  className="ml-auto w-8 h-8 rounded-lg text-gray-400 active:bg-red-50 active:text-red-500">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {chain && !dirty && (
        <p className="text-[var(--fs-xs)] text-gray-500 mb-2">{chain}</p>
      )}
      {error && (
        <p role="alert" className="text-[var(--fs-xs)] font-semibold text-red-600 mb-2">
          {error}
          {!loaded && (
            <button onClick={load} className="ml-2 underline font-bold">Retry</button>
          )}
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <button onClick={addRow} disabled={locked}
            className="text-[var(--fs-xs)] font-bold text-blue-700 active:opacity-70 disabled:opacity-40">
            + Add a level
          </button>
          {dirty && (
            <button onClick={save} disabled={saving}
              className="ml-auto px-3 py-1.5 rounded-lg bg-green-600 text-white text-[var(--fs-xs)] font-bold active:bg-green-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save packaging'}
            </button>
          )}
        </div>
      )}
      {rows.length > 1 && !dirty && (
        <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">
          Staff will count whole {pluralizePack(rows[0]?.name || 'box', 2)} first, then what is left.
        </p>
      )}
    </div>
  );
}
