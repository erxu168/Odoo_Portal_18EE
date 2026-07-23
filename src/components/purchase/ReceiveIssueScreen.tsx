'use client';

import React, { useState, useEffect, useCallback } from 'react';
import FilePicker from '@/components/ui/FilePicker';
import ManagedListSheet from '@/components/ui/ManagedListSheet';

interface IssueLine {
  product_name: string;
  product_uom: string;
  ordered_qty: number;
  issue_type: string | null;
  issue_notes: string | null;
}

interface ReceiveIssueScreenProps {
  line: IssueLine | null;
  onSubmit: (issueType: string, notes: string, photo: string) => void;
}

// Fallback shown until the managed list loads (seeds the same defaults server-side).
const DEFAULT_ISSUE_TYPES = ['Missing', 'Wrong quantity', 'Damaged', 'Expired', 'Wrong item', 'Other'];
// What the restaurant wants the supplier to do about it (Choco: credit / replacement / custom).
const RESOLUTIONS = ['Credit note', 'Replacement', 'Just record it'];

export default function ReceiveIssueScreen({ line, onSubmit }: ReceiveIssueScreenProps) {
  const [issueType, setIssueType] = useState(line?.issue_type || 'Missing');
  const [resolution, setResolution] = useState('Just record it');
  const [notes, setNotes] = useState(line?.issue_notes || '');
  const [photo, setPhoto] = useState('');
  // Delivery-issue types are now a managed list (add/rename/delete by an admin).
  const [issueTypes, setIssueTypes] = useState<string[]>(DEFAULT_ISSUE_TYPES);
  const [canManageTypes, setCanManageTypes] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const loadTypes = useCallback(async () => {
    try {
      const d = await fetch('/api/managed-lists/issue-types').then((r) => (r.ok ? r.json() : null));
      if (d?.meta) setCanManageTypes(!!d.meta.canWrite);
      if (Array.isArray(d?.items)) {
        const labels: string[] = d.items.map((i: { label: string }) => i.label);
        setIssueTypes(labels);
        // Reconcile the selection: keep it if it's still an option OR it's this
        // line's saved (possibly legacy/renamed) value; else drop to the first
        // available — or nothing if the list was emptied (never keep a deleted
        // default like "Missing" selected).
        setIssueType((prev) => (labels.includes(prev) || prev === (line?.issue_type || '') ? prev : (labels[0] ?? '')));
      }
    } catch { /* keep defaults */ }
  }, [line?.issue_type]);
  useEffect(() => { loadTypes(); }, [loadTypes]);
  // A saved value no longer in the list (removed/renamed) still shows selected.
  const displayTypes = issueType && !issueTypes.includes(issueType) ? [...issueTypes, issueType] : issueTypes;

  function handleFile(_file: File, dataUrl: string) {
    setPhoto(dataUrl);
  }

  function handleSubmit() {
    if (!issueType.trim()) return;   // never submit an empty / deleted type
    // Fold the requested resolution into the note so it travels with the issue
    // (shown to the manager on approval and posted to the Odoo purchase order).
    const parts: string[] = [];
    if (resolution && resolution !== 'Just record it') parts.push(`Wants: ${resolution}`);
    if (notes.trim()) parts.push(notes.trim());
    onSubmit(issueType, parts.join(' — '), photo);
  }

  return (
    <div className="px-4 py-3">
      <div className="text-[16px] font-bold text-gray-900 mb-1">{line?.product_name}</div>
      <div className="text-[13px] text-gray-500 mb-4">Ordered: {line?.ordered_qty} {line?.product_uom}</div>

      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400">What&rsquo;s wrong?</label>
        {canManageTypes && (
          <button onClick={() => setManageOpen(true)} className="text-[11px] font-bold text-[#F5800A] active:opacity-70">Edit types</button>
        )}
      </div>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {displayTypes.map((t) => (
          <button
            key={t}
            onClick={() => setIssueType(t)}
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold ${issueType === t ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {t}
          </button>
        ))}
        {displayTypes.length === 0 && (
          <p className="text-[12px] text-gray-400">No issue types set up{canManageTypes ? ' — add one with “Edit types”.' : ' — ask an admin to add some.'}</p>
        )}
      </div>

      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">What should happen?</label>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setResolution(r)}
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold ${resolution === r ? 'bg-[#F5800A] text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {r}
          </button>
        ))}
      </div>

      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Photo evidence</label>
      {photo ? (
        <div className="mb-4 relative">
          <img src={photo} alt="Issue photo" className="w-full h-48 object-cover rounded-xl border border-gray-200" />
          <button
            onClick={() => setPhoto('')}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white text-[14px]"
            aria-label="Remove photo"
          >
            &times;
          </button>
          <div className="mt-2 text-center">
            <FilePicker
              onFile={handleFile}
              accept="image/*"
              variant="button"
              label="Retake photo"
              icon=""
              className="text-[12px] font-semibold text-[#F5800A] active:opacity-70"
            />
          </div>
        </div>
      ) : (
        <FilePicker
          onFile={handleFile}
          accept="image/*"
          label="Tap to take photo (optional)"
          className="w-full mb-4 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center active:bg-gray-50 bg-white"
        />
      )}

      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add any detail (how many missing, what was wrong)…"
        rows={3}
        className="w-full text-[13px] border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-[#F5800A] mb-4"
      />

      <button
        onClick={handleSubmit}
        disabled={!issueType.trim()}
        className="w-full py-3.5 rounded-xl bg-[#F5800A] text-white text-[14px] font-bold shadow-lg shadow-[#F5800A]/30 active:bg-[#E86000] disabled:opacity-40"
      >
        Save issue
      </button>

      {manageOpen && (
        <ManagedListSheet listKey="issue-types" onChanged={loadTypes} onClose={() => setManageOpen(false)} />
      )}
    </div>
  );
}
