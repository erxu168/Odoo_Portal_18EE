'use client';

import React, { useState, useEffect } from 'react';

interface EditStepNoteSheetProps {
  moId: number;
  woId: number;
  stepNumber: number;
  stepName: string;
  initialText: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export default function EditStepNoteSheet({
  moId, woId, stepNumber, stepName, initialText, open, onClose, onSaved,
}: EditStepNoteSheetProps) {
  const [text, setText] = useState<string>(stripHtml(initialText));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText(stripHtml(initialText));
      setError(null);
    }
  }, [open, initialText]);

  if (!open) return null;

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/work-orders/${woId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_note: text }),
      });
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

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40"
         onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-5 pb-7"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
          Step {stepNumber}
        </div>
        <h2 className="mb-4 text-lg font-bold">{stepName}</h2>

        <label className="mb-1 block text-sm font-medium text-gray-700">
          Instructions
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="What to do at this step…"
          className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base focus:border-orange-500 focus:outline-none resize-y"
          autoFocus
        />
        <p className="mt-1 text-xs text-gray-500">
          Saving updates the recipe immediately. Save as a new version later to keep a history.
        </p>

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
            {saving ? 'Saving…' : 'Save'}
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
