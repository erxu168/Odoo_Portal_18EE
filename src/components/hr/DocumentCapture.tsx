"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import AppHeader from "@/components/ui/AppHeader";
import PdfViewer from "@/components/ui/PdfViewer";
import FilePicker from "@/components/ui/FilePicker";
import type { DocumentType } from "@/types/hr";

interface CapturedFile {
  id: string;
  dataUrl: string;
  isPdf: boolean;
}

interface ExistingDoc {
  id: number;
  name: string;
  doc_type_key: string;
  mimetype?: string;
}

interface ThumbnailData {
  base64: string;
  mimetype: string;
}

interface Props {
  docType: DocumentType;
  onBack: () => void;
  onSaved: () => void;
}

const DOC_HINTS: Record<string, string> = {
  ausweis: "Capture both the front and back of your ID card or passport.",
  aufenthaltstitel: "Capture the front, back, and any visa sticker pages.",
  vertrag: "If your contract has multiple pages, add each page separately.",
};

let _nextId = 1;
function nextId() {
  return "cap_" + _nextId++;
}

export default function DocumentCapture({ docType, onBack, onSaved }: Props) {
  const [captures, setCaptures] = useState<CapturedFile[]>([]);
  const [existingDocs, setExistingDocs] = useState<ExistingDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Preview/review state
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Thumbnails for existing docs
  const [thumbnails, setThumbnails] = useState<Record<number, ThumbnailData>>({});

  // Inline viewer for existing docs
  const [viewerData, setViewerData] = useState<{
    base64: string;
    mimetype: string;
    name: string;
  } | null>(null);
  const [loadingViewerId, setLoadingViewerId] = useState<number | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ExistingDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);


  useEffect(() => {
    fetch("/api/hr/documents")
      .then((r) => r.json())
      .then((d) => {
        const matching = (d.documents || []).filter(
          (doc: ExistingDoc) => doc.doc_type_key === docType.key
        );
        setExistingDocs(matching);
      })
      .catch(() => {});
  }, [docType.key]);

  // Fetch thumbnails for existing docs in background
  const fetchThumbnails = useCallback(async () => {
    if (existingDocs.length === 0) return;
    for (const doc of existingDocs) {
      if (thumbnails[doc.id]) continue;
      try {
        const res = await fetch("/api/hr/documents/" + doc.id);
        if (res.ok) {
          const data = await res.json();
          setThumbnails((prev) => ({
            ...prev,
            [doc.id]: { base64: data.data_base64, mimetype: data.mimetype },
          }));
        }
      } catch {
        // skip failed thumbnails
      }
    }
  }, [existingDocs, thumbnails]);

  useEffect(() => {
    fetchThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingDocs]);

  // --- Capture handler ---

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

  // --- Save handler ---

  async function handleSave() {
    if (captures.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: captures.length });

    try {
      const files: { filename: string; data_base64: string }[] = [];
      for (let i = 0; i < captures.length; i++) {
        setUploadProgress({ current: i + 1, total: captures.length });
        const cap = captures[i];
        let base64: string;

        if (cap.isPdf) {
          base64 = cap.dataUrl.split(",")[1];
        } else {
          base64 = await compressImage(cap.dataUrl);
        }

        const ext = cap.isPdf ? ".pdf" : ".jpg";
        const suffix = captures.length > 1 ? `_p${i + 1}` : "";
        const filename = `${docType.key}_${new Date().toISOString().slice(0, 10)}${suffix}${ext}`;
        files.push({ filename, data_base64: base64 });
      }

      const res = await fetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_type_key: docType.key, files }),
      });

      if (res.ok) {
        onSaved();
      }
    } catch (_e: unknown) {
      console.error("Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  // --- Delete existing doc ---

  async function handleDeleteDoc(doc: ExistingDoc) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        setExistingDocs((prev) => prev.filter((d) => d.id !== doc.id));
        setThumbnails((prev) => {
          const copy = { ...prev };
          delete copy[doc.id];
          return copy;
        });
      } else {
        const data = await res.json();
        setDeleteError(data.error || "Cannot delete this document");
      }
    } catch (_e: unknown) {
      setDeleteError("Failed to delete document");
    } finally {
      setDeleting(false);
    }
  }

  // --- Existing doc viewer ---

  async function handleViewExisting(doc: ExistingDoc) {
    // If we already fetched the data for thumbnail, reuse it
    const cached = thumbnails[doc.id];
    if (cached) {
      setViewerData({ base64: cached.base64, mimetype: cached.mimetype, name: doc.name });
      return;
    }

    setLoadingViewerId(doc.id);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id);
      if (res.ok) {
        const data = await res.json();
        setViewerData({
          base64: data.data_base64,
          mimetype: data.mimetype,
          name: data.name,
        });
        setThumbnails((prev) => ({
          ...prev,
          [doc.id]: { base64: data.data_base64, mimetype: data.mimetype },
        }));
      }
    } catch (_e: unknown) {
      console.error("Failed to load document");
    } finally {
      setLoadingViewerId(null);
    }
  }

  // --- Render: Inline viewer overlay ---

  // --- Render: Delete confirmation ---
  if (deleteTarget) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-6 max-w-[340px] w-full shadow-xl">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">Delete document?</div>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-1">
            <span className="font-semibold text-gray-700">{deleteTarget.name}</span>
          </p>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-4">
            This will archive the file in Odoo. The change will be logged.
          </p>
          {deleteError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-[var(--fs-xs)] text-red-700 font-semibold">{deleteError}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => { setDeleteTarget(null); setDeleteError(null); }} disabled={deleting}
              className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
              Cancel
            </button>
            <button onClick={() => handleDeleteDoc(deleteTarget)} disabled={deleting}
              className="flex-1 py-3 bg-red-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40 flex items-center justify-center gap-2">
              {deleting && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewerData) {
    const isPdf = viewerData.mimetype === "application/pdf";
    if (isPdf) {
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

  // --- Render: Full-size preview of a new capture ---

  if (previewIndex !== null && captures[previewIndex]) {
    const cap = captures[previewIndex];
    return (
      <div className="fixed inset-0 z-[200] bg-black flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
          <span className="text-white/60 text-[var(--fs-sm)] font-mono">
            {previewIndex + 1} / {captures.length}
          </span>
          <button
            onClick={() => setPreviewIndex(null)}
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          {cap.isPdf ? (
            <div className="bg-white rounded-xl p-8 text-center">
              <div className="text-5xl mb-3">{"\u{1F4C4}"}</div>
              <div className="text-[var(--fs-md)] font-bold text-gray-900">PDF document</div>
            </div>
          ) : (
            <img
              src={cap.dataUrl}
              alt={`Page ${previewIndex + 1}`}
              className="max-w-full max-h-[70vh] rounded-xl object-contain"
            />
          )}
        </div>

        {/* Actions */}
        <div className="p-4 pb-8 flex gap-3">
          <button
            onClick={() => removeCapture(cap.id)}
            className="flex-1 py-4 bg-red-500/20 text-red-400 font-semibold rounded-xl active:opacity-85 flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Delete
          </button>
          <button
            onClick={() => retakeCapture(cap.id)}
            className="flex-1 py-4 bg-white/20 text-white font-semibold rounded-xl active:opacity-85 flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Retake
          </button>
        </div>
      </div>
    );
  }

  // --- Render: Main capture screen ---

  const hint =
    DOC_HINTS[docType.key] ||
    "Take clear photos or choose files from your device.";

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <AppHeader
        title={docType.label}
        subtitle={docType.labelDe}
        showBack
        onBack={onBack}
      />

      <div className="p-5">
        {/* Existing uploaded docs with thumbnails */}
        {existingDocs.length > 0 && (
          <div className="mb-4">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
              Currently uploaded ({existingDocs.length})
            </div>
            <div className="grid grid-cols-3 gap-2.5 mb-2">
              {existingDocs.map((doc) => {
                const thumb = thumbnails[doc.id];
                const isImage = thumb && !thumb.mimetype.includes("pdf");
                const isPdf = thumb && thumb.mimetype === "application/pdf";
                const isLoading = loadingViewerId === doc.id;

                return (
                  <button
                    key={doc.id}
                    onClick={() => handleViewExisting(doc)}
                    disabled={isLoading}
                    className="relative aspect-square rounded-xl overflow-hidden border-2 border-green-600 bg-green-50 active:opacity-80 disabled:opacity-60"
                  >
                    {isImage ? (
                      <img
                        src={`data:${thumb.mimetype};base64,${thumb.base64}`}
                        alt={doc.name}
                        className="w-full h-full object-cover"
                      />
                    ) : isPdf ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50">
                        <div className="text-3xl">{"\u{1F4C4}"}</div>
                        <span className="text-[9px] text-gray-500 font-semibold mt-1 px-1 truncate max-w-full">PDF</span>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-green-50">
                        <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(doc); }}
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center active:bg-red-600 z-10"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>

                    {/* File name */}
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent">
                      <span className="text-[9px] text-white font-semibold truncate block">
                        {doc.name}
                      </span>
                    </div>

                    {/* Loading overlay */}
                    {isLoading && (
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[var(--fs-xs)] text-gray-400">
              Tap to view &middot; New uploads will replace these files
            </p>
          </div>
        )}

        {/* Hint text */}
        <p className="text-[var(--fs-sm)] text-gray-500 mb-4">{hint}</p>

        {/* Capture gallery */}
        {captures.length > 0 && (
          <div className="mb-4">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
              New captures ({captures.length})
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {captures.map((cap, idx) => (
                <div key={cap.id} className="relative aspect-square">
                  <button
                    onClick={() => setPreviewIndex(idx)}
                    className="w-full h-full rounded-xl overflow-hidden border-2 border-green-600 active:opacity-80"
                  >
                    {cap.isPdf ? (
                      <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center">
                        <div className="text-3xl">{"\u{1F4C4}"}</div>
                        <span className="text-[10px] text-gray-400 font-semibold mt-1">PDF</span>
                      </div>
                    ) : (
                      <img
                        src={cap.dataUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </button>
                  {/* Page number badge */}
                  <div className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold flex items-center justify-center">
                    {idx + 1}
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCapture(cap.id);
                    }}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center active:bg-red-600"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add more button in the grid */}
              <FilePicker
                onFile={onFilePicked}
                accept="image/*,.pdf"
                className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 bg-white active:bg-gray-50"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="text-[10px] text-gray-400 font-semibold">Add</span>
              </FilePicker>
            </div>
          </div>
        )}

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
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
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

/** Fullscreen image overlay with pinch-to-zoom */
function ImageOverlay({
  base64,
  mimetype,
  onClose,
}: {
  base64: string;
  mimetype: string;
  onClose: () => void;
}) {
  const imgSrc = `data:${mimetype};base64,${base64}`;
  const [scale, setScale] = useState(1);
  const pinchRef = useRef({ active: false, initialDist: 0, initialScale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onGestureStart(e: any) { e.preventDefault(); pinchRef.current = { active: true, initialDist: 0, initialScale: scale }; }
    function onGestureChange(e: any) { e.preventDefault(); setScale(Math.max(0.5, Math.min(5, pinchRef.current.initialScale * e.scale))); }
    function onGestureEnd(e: any) { e.preventDefault(); pinchRef.current.active = false; }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = { active: true, initialDist: Math.hypot(dx, dy), initialScale: scale };
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        setScale(Math.max(0.5, Math.min(5, pinchRef.current.initialScale * (dist / pinchRef.current.initialDist))));
      }
    }
    function onTouchEnd(e: TouchEvent) { if (e.touches.length < 2) pinchRef.current.active = false; }

    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", onGestureEnd, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scale]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
      <div className="flex items-center justify-end px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
        {scale !== 1 && (
          <button onClick={() => setScale(1)} className="mr-auto px-3 py-1 rounded-full bg-white/10 text-white/80 text-[var(--fs-xs)] font-mono font-bold active:bg-white/20">
            {Math.round(scale * 100)}% — tap to reset
          </button>
        )}
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto overscroll-contain flex items-center justify-center" style={{ WebkitOverflowScrolling: "touch" }}>
        <img src={imgSrc} alt="Document" className="max-w-full max-h-full object-contain transition-transform duration-100" style={{ transform: `scale(${scale})`, touchAction: "pan-x pan-y" }} />
      </div>
    </div>
  );
}

function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
        else { w = Math.round((w * MAX) / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("No canvas context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const result = canvas.toDataURL("image/jpeg", 0.85);
      resolve(result.split(",")[1]);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
