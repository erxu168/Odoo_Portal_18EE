'use client';

import React, { useState, useEffect } from 'react';

interface AddIngredientSheetProps {
  moId: number;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

interface ProductHit {
  id: number;
  name: string;
  uom_id: number;
  uom_name: string;
}

export default function AddIngredientSheet({
  moId, open, onClose, onAdded,
}: AddIngredientSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductHit[]>([]);
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery(''); setResults([]); setPicked(null); setQty(''); setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!query || picked) { setResults([]); return; }
    if (query.trim().length < 2) { setResults([]); return; }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/products/search?q=${encodeURIComponent(query)}&limit=20`,
          { signal: ctl.signal },
        );
        const data = await res.json();
        setResults(data.products || []);
      } catch {
        // aborts and net errors silently fall through
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [query, picked]);

  if (!open) return null;

  async function handleAdd() {
    setError(null);
    if (!picked) { setError('Pick an ingredient first.'); return; }
    const value = Number(qty);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: picked.id,
          qty: value,
          uom_id: picked.uom_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add');
      onAdded();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-7"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Add ingredient</h2>

        {picked ? (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-orange-50 px-3 py-3">
            <div>
              <div className="font-semibold">{picked.name}</div>
              <div className="text-xs text-gray-500">{picked.uom_name}</div>
            </div>
            <button
              onClick={() => setPicked(null)}
              className="text-sm text-orange-600 underline"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ingredient…"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-orange-500 focus:outline-none"
              autoFocus
            />
            {searching && (
              <div className="mb-2 text-xs text-gray-500">Searching…</div>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="mb-2 text-xs text-gray-500">No matches.</div>
            )}
            {results.length > 0 && (
              <ul className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
                {results.map((p) => (
                  <li
                    key={p.id}
                    onClick={() => setPicked(p)}
                    className="cursor-pointer border-b border-gray-100 px-3 py-3 last:border-b-0 hover:bg-orange-50"
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.uom_name}</div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {picked && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Quantity ({picked.uom_name})
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-3 text-lg font-mono focus:border-orange-500 focus:outline-none"
              autoFocus
            />
          </>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleAdd}
            disabled={saving || !picked}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add ingredient'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full rounded-full px-4 py-3 font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
