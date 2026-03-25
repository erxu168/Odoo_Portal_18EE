"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import AppHeader from "@/components/ui/AppHeader";
import PdfViewer from "@/components/ui/PdfViewer";
import DocumentCapture from "@/components/hr/DocumentCapture";
import { DOCUMENT_TYPES } from "@/types/hr";
import RoteKarteInfo from "@/components/hr/RoteKarteInfo";
import type { DocumentType } from "@/types/hr";

interface Doc {
  id: number;
  name: string;
  doc_type_key: string;
  mimetype?: string;
  size_kb: number;
  create_date: string;
}

interface ThumbnailData {
  base64: string;
  mimetype: string;
}

interface Props {
  onBack: () => void;
  onHome: () => void;
}

export default function MyDocuments({ onBack }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [thumbnails, setThumbnails] = useState<Record<number, ThumbnailData>>({});

  // Document viewer
  const [viewerData, setViewerData] = useState<{
    base64: string;
    mimetype: string;
    name: string;
  } | null>(null);
  const [loadingViewerId, setLoadingViewerId] = useState<number | null>(null);

  // DocumentCapture mode
  const [captureDocType, setCaptureDocType] = useState<DocumentType | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadDocs();
  }, []);

  async function loadDocs() {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/documents");
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents || []);
      }
    } catch (_e: unknown) {
      console.error("Failed to load docs");
    } finally {
      setLoading(false);
    }
  }

  function getDocsForType(key: string): Doc[] {
    return docs.filter((d) => d.doc_type_key === key);
  }

  // Fetch thumbnails in background
  const fetchThumbnails = useCallback(async () => {
    for (const doc of docs) {
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
        // skip
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  useEffect(() => {
    if (docs.length > 0) fetchThumbnails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  // View existing doc
  async function handleViewDoc(doc: Doc) {
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
        setViewerData({ base64: data.data_base64, mimetype: data.mimetype, name: data.name });
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

  // Delete a doc
  async function handleDeleteDoc(doc: Doc) {
    setDeleting(true);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        setThumbnails((prev) => {
          const copy = { ...prev };
          delete copy[doc.id];
          return copy;
        });
        await loadDocs();
      }
    } catch (_e: unknown) {
      console.error("Failed to delete document");
    } finally {
      setDeleting(false);
    }
  }

  // Replace/add docs via DocumentCapture
  function handleReplace(docType: DocumentType) {
    setCaptureDocType(docType);
  }

  function handleCaptureDone() {
    setCaptureDocType(null);
    setThumbnails({});
    loadDocs();
  }

  // --- Render: DocumentCapture mode ---
  if (captureDocType) {
    return (
      <DocumentCapture
        docType={captureDocType}
        onBack={() => setCaptureDocType(null)}
        onSaved={handleCaptureDone}
      />
    );
  }

  // --- Render: Inline viewer ---
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
    return <ImageOverlay base64={viewerData.base64} mimetype={viewerData.mimetype} onClose={() => setViewerData(null)} />;
  }

  // --- Render: Delete confirmation ---
  if (deleteTarget) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-6 max-w-[340px] w-full shadow-xl">
          <div className="text-[16px] font-bold text-gray-900 mb-2">Delete document?</div>
          <p className="text-[13px] text-gray-500 mb-1">
            <span className="font-semibold text-gray-700">{deleteTarget.name}</span>
          </p>
          <p className="text-[13px] text-gray-500 mb-5">
            This will archive the file in Odoo. The change will be logged on your employee record.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl active:opacity-85 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => handleDeleteDoc(deleteTarget)}
              disabled={deleting}
              className="flex-1 py-3 bg-red-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {deleting && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Render: Main documents list ---
  const required = DOCUMENT_TYPES.filter((dt) => dt.required);
  const optional = DOCUMENT_TYPES.filter((dt) => !dt.required);

  return (
    <div className="min-h-screen bg-[#f8faf9] pb-20">
      <AppHeader title="My Documents" showBack onBack={onBack} />

      <div className="p-5">
        <p className="text-[13px] text-gray-500 mb-4">
          Review your uploaded documents. Tap a thumbnail to view, or use the
          buttons to replace or add files.
        </p>

        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <RoteKarteInfo />
            <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">
              Required documents
            </div>
            {required.map((dt) => (
              <DocTypeCard
                key={dt.key}
                docType={dt}
                docs={getDocsForType(dt.key)}
                thumbnails={thumbnails}
                loadingViewerId={loadingViewerId}
                onView={handleViewDoc}
                onReplace={() => handleReplace(dt)}
                onDelete={(doc) => setDeleteTarget(doc)}
              />
            ))}

            <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mt-5 mb-2">
              Additional documents
            </div>
            {optional.map((dt) => (
              <DocTypeCard
                key={dt.key}
                docType={dt}
                docs={getDocsForType(dt.key)}
                thumbnails={thumbnails}
                loadingViewerId={loadingViewerId}
                onView={handleViewDoc}
                onReplace={() => handleReplace(dt)}
                onDelete={(doc) => setDeleteTarget(doc)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// --- DocTypeCard ---

interface DocTypeCardProps {
  docType: DocumentType;
  docs: Doc[];
  thumbnails: Record<number, ThumbnailData>;
  loadingViewerId: number | null;
  onView: (doc: Doc) => void;
  onReplace: () => void;
  onDelete: (doc: Doc) => void;
}

function DocTypeCard({
  docType,
  docs,
  thumbnails,
  loadingViewerId,
  onView,
  onReplace,
  onDelete,
}: DocTypeCardProps) {
  const hasUploads = docs.length > 0;

  return (
    <div
      className={
        "rounded-2xl border-[1.5px] p-4 mb-3 " +
        (hasUploads
          ? "border-green-600 bg-green-50 border-solid"
          : "border-gray-300 bg-white border-dashed")
      }
    >
      {/* Header row */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className={
            "w-10 h-10 rounded-xl flex items-center justify-center text-[20px] flex-shrink-0 " +
            (hasUploads ? "bg-green-100" : "bg-gray-100")
          }
        >
          {docType.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold text-gray-900">
              {docType.label}
            </span>
            <span className="text-[11px] text-gray-400">({docType.labelDe})</span>
          </div>
          <div className="text-[12px] text-gray-400 mt-0.5">
            {hasUploads ? (
              <span className="text-green-600 font-semibold">
                {docs.length} {docs.length === 1 ? "file" : "files"} uploaded
              </span>
            ) : (
              <span>{docType.required ? "Required" : "Optional"} &middot; Not uploaded</span>
            )}
          </div>
        </div>
        {hasUploads && (
          <span className="text-green-600 text-xl flex-shrink-0">{"\u2713"}</span>
        )}
      </div>

      {/* Thumbnail grid for uploaded files */}
      {hasUploads && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {docs.map((doc) => {
            const thumb = thumbnails[doc.id];
            const isImage = thumb && !thumb.mimetype.includes("pdf");
            const isPdf = thumb && thumb.mimetype === "application/pdf";
            const isLoading = loadingViewerId === doc.id;

            return (
              <div key={doc.id} className="relative aspect-square group">
                <button
                  onClick={() => onView(doc)}
                  disabled={isLoading}
                  className="w-full h-full rounded-xl overflow-hidden border border-green-300 bg-green-50 active:opacity-80 disabled:opacity-60"
                >
                  {isImage ? (
                    <img
                      src={`data:${thumb.mimetype};base64,${thumb.base64}`}
                      alt={doc.name}
                      className="w-full h-full object-cover"
                    />
                  ) : isPdf ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50">
                      <div className="text-2xl">{"\u{1F4C4}"}</div>
                      <span className="text-[9px] text-gray-500 font-semibold mt-0.5">PDF</span>
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}

                  {/* Filename overlay */}
                  <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent rounded-b-xl">
                    <span className="text-[8px] text-white font-semibold truncate block leading-tight">
                      {doc.name}
                    </span>
                  </div>

                  {isLoading && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
                      <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </button>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(doc);
                  }}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center active:bg-red-600"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Action button */}
      <button
        onClick={onReplace}
        className={
          "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[13px] active:opacity-85 transition-colors " +
          (hasUploads
            ? "bg-white border border-green-300 text-green-700 active:bg-green-100"
            : "bg-green-600 text-white active:bg-green-700")
        }
      >
        {hasUploads ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Replace or add files
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Upload document
          </>
        )}
      </button>
    </div>
  );
}

// --- ImageOverlay ---

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
    return () => { document.body.style.overflow = ""; };
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
          <button onClick={() => setScale(1)} className="mr-auto px-3 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-mono font-bold active:bg-white/20">
            {Math.round(scale * 100)}% — tap to reset
          </button>
        )}
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
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
