'use client';

import React, { useState } from 'react';
import FilePicker from '@/components/ui/FilePicker';

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

// Choco-aligned issue categories.
const ISSUE_TYPES = ['Missing', 'Wrong quantity', 'Damaged', 'Expired', 'Wrong item', 'Other'];
// What the restaurant wants the supplier to do about it (Choco: credit / replacement / custom).
const RESOLUTIONS = ['Credit note', 'Replacement', 'Just record it'];

export default function ReceiveIssueScreen({ line, onSubmit }: ReceiveIssueScreenProps) {
  const [issueType, setIssueType] = useState(line?.issue_type || 'Missing');
  const [resolution, setResolution] = useState('Just record it');
  const [notes, setNotes] = useState(line?.issue_notes || '');
  const [photo, setPhoto] = useState('');

  function handleFile(_file: File, dataUrl: string) {
    setPhoto(dataUrl);
  }

  function handleSubmit() {
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

      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">What&rsquo;s wrong?</label>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {ISSUE_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setIssueType(t)}
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold ${issueType === t ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {t}
          </button>
        ))}
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
        className="w-full py-3.5 rounded-xl bg-[#F5800A] text-white text-[14px] font-bold shadow-lg shadow-[#F5800A]/30 active:bg-[#E86000]"
      >
        Save issue
      </button>
    </div>
  );
}
