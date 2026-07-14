"use client";

import React, { useState } from "react";
import PdfViewer from "@/components/ui/PdfViewer";

/**
 * DocumentUploadWidget — Reusable document attachment component.
 *
 * Handles upload, view, replace, and delete for any document attachment.
 * Shows a dashed upload button when empty, or a card with view/replace/delete
 * actions when a document exists.
 *
 * Usage:
 *   <DocumentUploadWidget
 *     label="Courier confirmation"
 *     hasDocument={!!rec.delivery_proof_attachment_id}
 *     documentName={rec.delivery_proof_attachment_id?.[1]}
 *     onUpload={async (file) => { ... }}
 *     onView={async () => { return { base64, mimetype, name }; }}
 *     onDelete={async () => { ... }}
 *   />
 */

interface DocumentData {
  base64: string;
  mimetype: string;
  name: string;
}

interface DocumentUploadWidgetProps {
  /** Label shown on the upload button and document card */
  label: string;
  /** Whether a document is already uploaded */
  hasDocument: boolean;
  /** Name of the existing document (from Odoo M2O field) */
  documentName?: string;
  /** Called when a file is selected for upload. Should persist to backend. */
  onUpload: (file: File) => Promise<void>;
  /** Called to fetch document data for viewing. Return base64 + mimetype + name. */
  onView: () => Promise<DocumentData>;
  /** Called to delete the document. Should persist to backend. */
  onDelete?: () => Promise<void>;
  /** File accept string. Default: "image/*,application/pdf" */
  accept?: string;
  /** Upload button label when empty. Default: "Upload {label}" */
  uploadLabel?: string;
  /** Icon for the document card. Default: document check icon */
  icon?: React.ReactNode;
  /** Disable all actions */
  disabled?: boolean;
}

export default function DocumentUploadWidget({
  label,
  hasDocument,
  documentName,
  onUpload,
  onView,
  onDelete,
  accept = "image/*,application/pdf",
  uploadLabel,
  icon,
  disabled = false,
}: DocumentUploadWidgetProps) {
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewData, setViewData] = useState<DocumentData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  async function handleView() {
    setViewing(true);
    try {
      const data = await onView();
      setViewData(data);
    } finally {
      setViewing(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const defaultIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  );

  // --- Viewer modal ---
  if (viewData) {
    if (viewData.mimetype === "application/pdf") {
      return (
        <PdfViewer
          fileData={viewData.base64}
          fileName={viewData.name}
          onClose={() => setViewData(null)}
        />
      );
    }
    return (
      <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-black/80">
          <span className="text-white/80 text-[var(--fs-sm)] font-semibold">{viewData.name}</span>
          <button
            onClick={() => setViewData(null)}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center p-4">
          <img
            src={`data:${viewData.mimetype};base64,${viewData.base64}`}
            alt={label}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      </div>
    );
  }

  // --- Delete confirmation ---
  if (confirmDelete) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-6 max-w-[340px] w-full shadow-xl">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">Delete document?</div>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-1">
            <span className="font-semibold text-gray-700">{documentName || label}</span>
          </p>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-5">
            This will remove the attached file from the record.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-3 bg-red-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {deleting && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Document exists: show card with actions ---
  if (hasDocument) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            {icon || defaultIcon}
          </div>
          <div className="min-w-0">
            <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">{label}</div>
            <div className="text-[var(--fs-xs)] text-green-600">Uploaded</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleView}
            disabled={viewing || disabled}
            className="px-3 py-1.5 bg-gray-100 text-[var(--fs-xs)] font-bold text-gray-700 rounded-lg active:bg-gray-200 disabled:opacity-50"
          >
            {viewing ? "..." : "View"}
          </button>
          <label className="px-3 py-1.5 bg-gray-100 text-[var(--fs-xs)] font-bold text-gray-700 rounded-lg active:bg-gray-200 cursor-pointer">
            Replace
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
              disabled={uploading || disabled}
            />
          </label>
          {onDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={disabled}
              className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center active:bg-red-100"
              title="Delete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-500">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- No document: show upload button ---
  return (
    <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-[1.5px] border-dashed border-gray-300 text-[var(--fs-sm)] font-semibold text-gray-500 active:bg-gray-50 cursor-pointer ${disabled || uploading ? "opacity-50 pointer-events-none" : ""}`}>
      {uploading ? (
        <>
          <div className="w-4 h-4 border-2 border-gray-400 border-t-green-600 rounded-full animate-spin" />
          Uploading...
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {uploadLabel || `Upload ${label.toLowerCase()}`}
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
  );
}
