'use client';

import React, { useState } from 'react';
import FilePicker from "@/components/ui/FilePicker";
import { ReceiptLine } from './types';

interface ReceiveIssueProps {
  issueLine: ReceiptLine | null;
  issuePhoto: string;
  setIssuePhoto: (v: string) => void;
  submitIssue: (issueType: string, notes: string, photo?: string) => void;
}

export default function ReceiveIssue({ issueLine, issuePhoto, setIssuePhoto, submitIssue }: ReceiveIssueProps) {
  const [issueType, setIssueType] = useState(issueLine?.issue_type || 'Damaged');
  const [notes, setNotes] = useState(issueLine?.issue_notes || '');
  const [localPhoto, setLocalPhoto] = useState(issuePhoto);
  const types = ['Damaged', 'Wrong item', 'Short delivery', 'Expired', 'Quality', 'Other'];

  function handleFilePickerPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => { const base64 = reader.result as string; setLocalPhoto(base64); setIssuePhoto(base64); };
    reader.readAsDataURL(file);
  }

  return (
    <div className="px-4 py-3">
      <div className="text-[15px] font-bold text-gray-900 mb-1">{issueLine?.product_name}</div>
      <div className="text-[12px] text-gray-500 mb-4">Ordered: {issueLine?.ordered_qty} {issueLine?.product_uom}</div>
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Photo evidence</label>
      {localPhoto ? (
        <div className="mb-4 relative">
          <img src={localPhoto} alt="Issue photo" className="w-full h-48 object-cover rounded-xl border border-gray-200" />
          <button onClick={() => { setLocalPhoto(''); setIssuePhoto(''); }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white text-[14px]">&times;</button>
          <div className="mt-2 text-center">
            <FilePicker onFile={(file) => handleFilePickerPhoto(file)} accept="image/*" variant="button" label="Retake photo" icon="" className="text-[12px] font-semibold text-green-700 active:opacity-70" />
          </div>
        </div>
      ) : (
        <FilePicker onFile={(file) => handleFilePickerPhoto(file)} accept="image/*" label="Tap to take photo" className="w-full mb-4 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center active:bg-gray-50 bg-white" />
      )}
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Issue type</label>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {types.map(t => (
          <button key={t} onClick={() => setIssueType(t)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold ${issueType === t ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{t}</button>
        ))}
      </div>
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Notes</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe the issue..." rows={3} className="w-full text-[13px] border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-green-500 mb-4" />
      <button onClick={() => submitIssue(issueType, notes, localPhoto)} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30">Submit report</button>
    </div>
  );
}
