"use client";

import React, { useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import PdfViewer from "@/components/ui/PdfViewer";
import FilePicker from "@/components/ui/FilePicker";
import type { DocumentType } from "@/types/hr";
import CapturePreview from "./CapturePreview";
import type { CapturedFile } from "./CapturePreview";
import ExistingDocsGrid from "./ExistingDocsGrid";
import NewCapturesGrid from "./NewCapturesGrid";
import DeleteDocDialog from "./DeleteDocDialog";
import ImageOverlay from "./ImageOverlay";
import { useExistingDocs } from "./useExistingDocs";
import { useDocumentUpload } from "./useDocumentUpload";

const DOC_HINTS: Record<string, string> = {
  ausweis: "Capture both the front and back of your ID card or passport.",
  aufenthaltstitel: "Capture the front, back, and any visa sticker pages.",
  vertrag: "If your contract has multiple pages, add each page separately.",
};

let _nextId = 1;
function nextId() {
  return "cap_" + _nextId++;
}

interface Props {
  docType: DocumentType;
  onBack: () => void;
  onSaved: () => void;
}

export default function DocumentCapture({ docType, onBack, onSaved }: Props) {
  const [captures, setCaptures] = useState<CapturedFile[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const {
    existingDocs,
    thumbnails,
    viewerData,
    setViewerData,
    loadingViewerId,
    deleteTarget,
    setDeleteTarget,
    deleting,
    deleteError,
    handleViewExisting,
    handleDeleteDoc,
    clearDeleteTarget,
  } = useExistingDocs(docType.key);

  const { uploading, uploadProgress, handleSave } = useDocumentUpload(docType.key, onSaved);

  // --- Capture handlers ---

  function onFilePicked(file: File, dataUrl: string) {
    const isPdf = file.type === "application/pdf" || dataUrl.includes("application/pdf");
    setCaptures((prev) => [...prev, { id: nextId(), dataUrl, isPdf }]);
  }

  function removeCapture(id: string) {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    setPreviewIndex(null);
  }

  function retakeCapture(id: string) {
    removeCapture(id);
    setPreviewIndex(null);
  }

  // --- Render: Conditional overlays ---

  if (deleteTarget) {
    return (
      <DeleteDocDialog
        doc={deleteTarget}
        deleting={deleting}
        error={deleteError}
        onCancel={clearDeleteTarget}
        onConfirm={() => handleDeleteDoc(deleteTarget)}
      />
    );
  }

  if (viewerData) {
    if (viewerData.mimetype === "application/pdf") {
      return (
        <PdfViewer
          fileData={viewerData.base64}
          fileName={viewerData.name}
          onClose={() => setViewerData(null)}
        />
      );
    }
    return (
      <ImageOverlay
        base64={viewerData.base64}
        mimetype={viewerData.mimetype}
        onClose={() => setViewerData(null)}
      />
    );
  }

  if (previewIndex !== null && captures[previewIndex]) {
    return (
      <CapturePreview
        capture={captures[previewIndex]}
        index={previewIndex}
        total={captures.length}
        onRemove={removeCapture}
        onRetake={retakeCapture}
        onClose={() => setPreviewIndex(null)}
      />
    );
  }

  // --- Render: Main capture screen ---

  const hint =
    DOC_HINTS[docType.key] ||
    "Take clear photos or choose files from your device.";

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <AppHeader
        title={docType.label}
        subtitle={docType.labelDe}
        showBack
        onBack={onBack}
      />

      <div className="p-5">
        <ExistingDocsGrid
          docs={existingDocs}
          thumbnails={thumbnails}
          loadingViewerId={loadingViewerId}
          onView={handleViewExisting}
          onDeleteRequest={setDeleteTarget}
        />

        {/* Hint text */}
        <p className="text-[var(--fs-sm)] text-gray-500 mb-4">{hint}</p>

        <NewCapturesGrid
          captures={captures}
          onPreview={setPreviewIndex}
          onRemove={removeCapture}
          onFilePicked={onFilePicked}
        />

        {/* Source buttons */}
        <div className="flex gap-3 mb-2">
          <FilePicker
            onFile={onFilePicked}
            accept="image/*,.pdf"
            className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-white border-[1.5px] border-gray-200 rounded-2xl active:bg-gray-50 active:shadow-lg transition-all"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[var(--fs-md)] font-bold text-gray-900">Take Photo</span>
          </FilePicker>
          <FilePicker
            onFile={onFilePicked}
            accept="image/*,.pdf"
            className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-white border-[1.5px] border-gray-200 rounded-2xl active:bg-gray-50 active:shadow-lg transition-all"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span className="text-[var(--fs-md)] font-bold text-gray-900">Choose Files</span>
          </FilePicker>
        </div>

        {captures.length === 0 && (
          <p className="text-[var(--fs-xs)] text-gray-400 text-center mt-2">
            You can add multiple pages or files for this document.
          </p>
        )}
      </div>

      {/* Bottom bar */}
      <div className="px-5 pt-4 pb-8 flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85"
        >
          Cancel
        </button>
        <button
          onClick={() => handleSave(captures)}
          disabled={uploading || captures.length === 0}
          className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              {uploadProgress
                ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...`
                : "Uploading..."}
            </>
          ) : captures.length > 0 ? (
            `Save ${captures.length} ${captures.length === 1 ? "file" : "files"}`
          ) : (
            "Save document"
          )}
        </button>
      </div>
    </div>
  );
}
