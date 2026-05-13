'use client';

import React, { useState, useEffect } from 'react';

interface SaveAsVersionModalProps {
  moId: number;
  open: boolean;
  productName: string;
  sourceVersionLabel: string;
  onClose: () => void;
  onSaved: (result: { bom_id: number; version_label: string }) => void;
}

function suggestNextLabel(source: string): string {
  const m = source.match(/^v\.(\d+)(.*)$/i);
  if (m) {
    const next = Number(m[1]) + 1;
    return `v.${next}${m[2]}`;
  }
  return `${source || 'v.1'} v.2`;
}

export default function SaveAsVersionModal({
  moId, open, productName, sourceVersionLabel, onClose, onSaved,
}: SaveAsVersionModalProps) {
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel(suggestNextLabel(sourceVersionLabel || 'v.1'));
      setNotes('');
      setMakeCurrent(true);
      setError(null);
    }
  }, [open, sourceVersionLabel]);

  if (!open) return null;

  async function handleSave() {
    setError(null);
    if (!label.trim()) { setError('Version label is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/save-as-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version_label: label.trim(),
          version_notes: notes.trim(),
          make_current: makeCurrent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({ bom_id: data.bom_id, version_label: data.version_label });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Save changes as a new version</h2>
        <p className="mt-1 text-sm text-gray-500">
          Source: <span className="font-medium">{productName}</span>
          {' '}— <span className="font-mono">{sourceVersionLabel}</span>
        </p>

        <label className="mt-4 mb-1 block text-sm font-medium text-gray-700">Version</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          className="w-full rounded-lg border border-gray-300 px-3 py-3 font-mono focus:border-orange-500 focus:outline-none"
        />

        <label className="mt-4 mb-1 block text-sm font-medium text-gray-700">What changed</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="More salt. Added lime juice. Punchier."
          className="w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-orange-500 focus:outline-none"
        />

        <label className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            checked={makeCurrent}
            onChange={(e) => setMakeCurrent(e.target.checked)}
            className="h-5 w-5 accent-orange-500"
          />
          <span className="text-sm text-gray-800">Use this as the default recipe for new batches</span>
        </label>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as new version'}
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
