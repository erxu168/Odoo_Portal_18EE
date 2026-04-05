'use client';

import React, { useState } from 'react';
import PdfViewer from '@/components/ui/PdfViewer';

/**
 * PdfDocumentCard — Reusable PDF document widget.
 *
 * Three states:
 * 1. Empty: dashed upload slot
 * 2. Has document: card with filename + View / Print / Replace buttons
 * 3. Viewing: fullscreen PdfViewer with scroll + pinch-to-zoom
 *
 * Usage:
 *   <PdfDocumentCard
 *     label="Signed document"
 *     hasDocument={!!rec.signed_pdf_attachment_id}
 *     documentName="Kuendigung_unterschrieben.pdf"
 *     onView={async () => ({ base64: '...', name: '...' })}
 *     onUpload={async (file) => { ... }}
 *     onPrint={async () => { ... }}
 *     accent="green"
 *   />
 */

interface PdfDocumentCardProps {
  /** Card title / label */
  label: string;
  /** Whether a document exists */
  hasDocument: boolean;
  /** Filename to display */
  documentName?: string;
  /** Fetch PDF data for viewing. Return base64 string + filename. */
  onView: () => Promise<{ base64: string; name: string }>;
  /** Upload/replace the document */
  onUpload: (file: File) => Promise<void>;
  /** Print the document (opens in new tab) */
  onPrint: () => Promise<void>;
  /** Accent color for the icon */
  accent?: 'green' | 'blue' | 'gray';
  /** File accept types. Default: "image/*,.pdf" */
  accept?: string;
  /** Upload slot label when empty */
  emptyLabel?: string;
  /** Disable all actions */
  disabled?: boolean;
}

export default function PdfDocumentCard({
  label,
  hasDocument,
  documentName,
  onView,
  onUpload,
  onPrint,
  accent = 'green',
  accept = 'image/*,.pdf',
  emptyLabel,
  disabled = false,
}: PdfDocumentCardProps) {
  const [uploading, setUploading] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [pdfData, setPdfData] = useState<{ base64: string; name: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const accentStyles = {
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600', icon: '#16A34A' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', icon: '#2563EB' },
    gray: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-500', icon: '#6B7280' },
  }[accent];

  async function handleView() {
    setErrorMsg(null);
    setViewLoading(true);
    try {
      const data = await onView();
      setPdfData(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setViewLoading(false);
    }
  }

  async function handleUpload(file: File) {
    setErrorMsg(null);
    setUploading(true);
    try {
      await onUpload(file);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handlePrint() {
    setErrorMsg(null);
    try {
      await onPrint();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Print failed');
    }
  }

  // --- PdfViewer modal ---
  if (pdfData) {
    return (
      <PdfViewer
        fileData={pdfData.base64}
        fileName={pdfData.name}
        onClose={() => setPdfData(null)}
      />
    );
  }

  // --- No document: upload slot ---
  if (!hasDocument) {
    return (
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <span className="text-[13px] font-semibold text-gray-900 block mb-2">{label}</span>
        {errorMsg && (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2">
            <span className="text-[12px] text-red-700 font-medium">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-500 text-[11px] font-bold ml-2">Dismiss</button>
          </div>
        )}
        <label className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border-[1.5px] border-dashed border-gray-300 text-[13px] font-semibold text-gray-500 active:bg-gray-50 cursor-pointer ${disabled || uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? (
            <>
              <div className="w-4 h-4 border-2 border-gray-400 border-t-green-600 rounded-full animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {emptyLabel || `Upload ${label.toLowerCase()}`}
            </>
          )}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
            disabled={uploading || disabled}
          />
        </label>
      </div>
    );
  }

  // --- Has document: card with actions ---
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      {/* Document header: tap anywhere to view */}
      <button
        onClick={handleView}
        disabled={viewLoading || disabled}
        className="flex items-center gap-3 w-full text-left mb-3 active:opacity-80"
      >
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl ${accentStyles.bg} border ${accentStyles.border} flex items-center justify-center`}>
          {viewLoading ? (
            <div className={`w-5 h-5 border-2 border-gray-200 rounded-full animate-spin`} style={{ borderTopColor: accentStyles.icon }} />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentStyles.icon} strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M9 15l2 2 4-4" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-gray-900">{label}</div>
          <div className={`text-[11px] ${accentStyles.text} truncate`}>{documentName || 'Document uploaded'}</div>
        </div>
      </button>

      {errorMsg && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
          <span className="text-[12px] text-red-700 font-medium">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 text-[11px] font-bold ml-2">Dismiss</button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleView}
          disabled={viewLoading || disabled}
          className="flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          View
        </button>
        <button
          onClick={handlePrint}
          disabled={disabled}
          className="flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
          </svg>
          Print
        </button>
        <label className={`flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100 cursor-pointer ${disabled || uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          {uploading ? (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
          Replace
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
            disabled={uploading || disabled}
          />
        </label>
      </div>
    </div>
  );
}
