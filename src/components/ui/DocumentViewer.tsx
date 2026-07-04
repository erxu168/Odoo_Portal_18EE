'use client';

import React, { useEffect } from 'react';
import PdfViewer from '@/components/ui/PdfViewer';

interface Props {
  base64: string;
  mimetype: string;
  name: string;
  onClose: () => void;
}

/**
 * Full-screen viewer for an already-fetched document (base64 from
 * /api/hr/documents/[id]). PDFs use the shared PdfViewer; images render in a
 * dark overlay. Shared so employee cards, My Documents, etc. can reuse it.
 */
export default function DocumentViewer({ base64, mimetype, name, onClose }: Props) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (mimetype === 'application/pdf') {
    return <PdfViewer fileData={base64} fileName={name} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0">
        <span className="text-[var(--fs-sm)] font-semibold truncate pr-3">{name}</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        <img src={`data:${mimetype};base64,${base64}`} alt={name} className="max-w-full max-h-full object-contain" />
      </div>
    </div>
  );
}
