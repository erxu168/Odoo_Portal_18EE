'use client';

import React, { useState, useRef, useCallback } from 'react';
import PdfViewer from '@/components/ui/PdfViewer';

interface KuendigungDocWidgetProps {
  terminationId: number;
  employeeName: string;
  hasPdf: boolean;
  hasSignedPdf: boolean;
  signedPdfName?: string;
  onRecordUpdate: (data: any) => void;
}

export default function KuendigungDocWidget({
  terminationId,
  employeeName,
  hasPdf,
  hasSignedPdf,
  signedPdfName,
  onRecordUpdate,
}: KuendigungDocWidgetProps) {
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- PDF View ---
  const handleView = useCallback(async () => {
    setViewLoading(true);
    try {
      const res = await fetch(`/api/termination/${terminationId}/pdf`);
      if (!res.ok) { alert('No PDF available'); return; }
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setPdfBase64(base64);
        setShowPdf(true);
      };
      reader.readAsDataURL(blob);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to load PDF');
    } finally {
      setViewLoading(false);
    }
  }, [terminationId]);

  // --- PDF Print ---
  const handlePrint = useCallback(async () => {
    setPrintLoading(true);
    try {
      const res = await fetch(`/api/termination/${terminationId}/pdf`);
      if (!res.ok) { alert('No PDF available'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          setTimeout(() => printWindow.print(), 500);
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to print');
    } finally {
      setPrintLoading(false);
    }
  }, [terminationId]);

  // --- Upload signed ---
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-picked
    if (fileInputRef.current) fileInputRef.current.value = '';

    setUploadLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const filename = `Kuendigung_unterschrieben_${employeeName.replace(/\s+/g, '_')}.pdf`;

      const res = await fetch(`/api/termination/${terminationId}/upload-signed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: dataUrl, filename }),
      });

      const json = await res.json();
      if (json.ok) {
        onRecordUpdate(json.data);
      } else {
        alert(json.error || 'Upload failed');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  }, [terminationId, employeeName, onRecordUpdate]);

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // --- No PDF at all ---
  if (!hasPdf) return null;

  const isSigned = hasSignedPdf;

  return (
    <>
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        {/* Header row: icon + text */}
        <div className="flex items-center gap-3 mb-3">
          {isSigned ? (
            /* Signed document icon — green */
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M9 15l2 2 4-4" />
              </svg>
            </div>
          ) : (
            /* Unsigned document icon — gray */
            <div className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[var(--fs-sm)] font-semibold text-gray-900">
              {isSigned ? 'K\u00fcndigung (signed)' : 'K\u00fcndigung'}
            </div>
            <div className="text-[11px] text-gray-500 truncate">
              {isSigned
                ? (signedPdfName || 'Signed document')
                : 'Generated \u2014 not yet signed'
              }
            </div>
          </div>
        </div>

        {/* Action buttons row */}
        <div className="flex gap-2">
          {/* View */}
          <button
            onClick={handleView}
            disabled={viewLoading}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[13px] flex items-center justify-center gap-1.5 active:bg-gray-200 disabled:opacity-50"
          >
            {viewLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
            View
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            disabled={printLoading}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[13px] flex items-center justify-center gap-1.5 active:bg-gray-200 disabled:opacity-50"
          >
            {printLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            )}
            Print
          </button>

          {/* Upload signed / Replace */}
          <button
            onClick={triggerFilePicker}
            disabled={uploadLoading}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-50 ${
              isSigned
                ? 'bg-gray-100 text-gray-700 active:bg-gray-200'
                : 'bg-green-600 text-white active:bg-green-700'
            }`}
          >
            {uploadLoading ? (
              <div className={`w-3.5 h-3.5 border-2 rounded-full animate-spin ${
                isSigned
                  ? 'border-gray-400 border-t-transparent'
                  : 'border-white/40 border-t-white'
              }`} />
            ) : isSigned ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            {isSigned ? 'Replace' : 'Upload signed'}
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* PDF Viewer modal */}
      {showPdf && pdfBase64 && (
        <PdfViewer
          fileData={pdfBase64}
          fileName={`Kuendigung_${employeeName.replace(/\s+/g, '_')}.pdf`}
          onClose={() => setShowPdf(false)}
        />
      )}
    </>
  );
}
