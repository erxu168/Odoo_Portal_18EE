'use client';

import React, { useState } from 'react';

interface Component {
  move_id: number;
  product_id: [number, string];
  product_uom: [number, string];
  planned_qty: number;
}

interface EditComponentSheetProps {
  moId: number;
  component: Component;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const fmtDe = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4, useGrouping: false }).format(n);

export default function EditComponentSheet({
  moId, component, open, onClose, onSaved,
}: EditComponentSheetProps) {
  const [qty, setQty] = useState<string>(fmtDe(component.planned_qty));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSave() {
    setError(null);
    // Accept German-locale input ("0,0835") and US-locale ("0.0835").
    const value = Number(qty.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/components/${component.move_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qty: value }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove ${component.product_id[1]} from this batch?`)) return;
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/components/${component.move_id}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove');
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40"
         onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-7"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
          {component.product_uom[1]}
        </div>
        <h2 className="mb-4 text-lg font-bold">{component.product_id[1]}</h2>

        <label className="mb-1 block text-sm font-medium text-gray-700">Quantity</label>
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-3 text-lg font-mono focus:border-orange-500 focus:outline-none"
          autoFocus
        />

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving || removing}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleRemove}
            disabled={saving || removing}
            className="w-full rounded-full border border-gray-300 px-4 py-3 font-semibold text-red-600 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove ingredient'}
          </button>
          <button
            onClick={onClose}
            disabled={saving || removing}
            className="w-full rounded-full px-4 py-3 font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
