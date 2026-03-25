"use client";

import React, { useState, useEffect, useRef } from "react";
import AppHeader from "@/components/ui/AppHeader";
import PdfViewer from "@/components/ui/PdfViewer";
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

  // Inline viewer for existing docs
  const [viewerData, setViewerData] = useState<{
    base64: string;
    mimetype: string;
    name: string;
  } | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);

  // Hidden file inputs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // --- Capture handlers ---

  function handleCameraCapture() {
    cameraInputRef.current?.click();
  }

  function handleFilePick() {
    fileInputRef.current?.click();
  }

  function handleCameraFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFileToCapture(file);
    e.target.value = "";
  }

  function handleDeviceFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      readFileToCapture(files[i]);
    }
    e.target.value = "";
  }

  function readFileToCapture(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const isPdf = file.type === "application/pdf" || dataUrl.includes("application/pdf");
      setCaptures((prev) => [...prev, { id: nextId(), dataUrl, isPdf }]);
    };
    reader.readAsDataURL(file);
  }

  function removeCapture(id: string) {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
    setPreviewIndex(null);
  }

  function retakeCapture(id: string) {
    const idx = captures.findIndex((c) => c.id === id);
    removeCapture(id);
    setPreviewIndex(null);
    // Open camera after a short delay
    setTimeout(() => {
      handleCameraCapture();
    }, 150);
  }

  // --- Save handler ---

  async function handleSave() {
    if (captures.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: captures.length });

    try {
      // Prepare all files
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
        body: JSON.stringify({
          doc_type_key: docType.key,
          files,
        }),
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

  // --- Existing doc viewer ---

  async function handleViewExisting(doc: ExistingDoc) {
    setLoadingViewer(true);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id);
      if (res.ok) {
        const data = await res.json();
        setViewerData({
          base64: data.data_base64,
          mimetype: data.mimetype,
          name: data.name,
        });
      }
    } catch (_e: unknown) {
      console.error("Failed to load document");
    } finally {
      setLoadingViewer(false);
    }
  }

  // --- Render: Inline viewer overlay ---

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
          <span className="text-white/60 text-[13px] font-mono">
            {previewIndex + 1} / {captures.length}
          </span>
          <button
            onClick={() => setPreviewIndex(null)}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          {cap.isPdf ? (
            <div className="bg-white rounded-xl p-8 text-center">
              <div className="text-5xl mb-3">{"\u{1F4C4}"}</div>
              <div className="text-[14px] font-semibold text-gray-900">
                PDF document
              </div>
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Delete
          </button>
          <button
            onClick={() => retakeCapture(cap.id)}
            className="flex-1 py-4 bg-white/20 text-white font-semibold rounded-xl active:opacity-85 flex items-center justify-center gap-2"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
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
    <div className="min-h-screen bg-[#f8faf9] pb-40">
      <AppHeader
        title={docType.label}
        subtitle={docType.labelDe}
        showBack
        onBack={onBack}
      />

      <div className="p-5">
        {/* Existing uploaded docs */}
        {existingDocs.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">
              Currently uploaded
            </div>
            {existingDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => handleViewExisting(doc)}
                disabled={loadingViewer}
                className="w-full mb-2 p-3.5 bg-green-50 border border-green-600 rounded-2xl flex items-center gap-3 text-left active:shadow-lg disabled:opacity-60"
              >
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-green-600 flex-shrink-0">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-green-700 truncate">
                    {doc.name}
                  </div>
                  <div className="text-[11px] text-green-600 mt-0.5">
                    Tap to view
                  </div>
                </div>
                {loadingViewer && (
                  <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </button>
            ))}
            <p className="text-[12px] text-gray-400 mt-1">
              New uploads will replace existing files.
            </p>
          </div>
        )}

        {/* Hint text */}
        <p className="text-[13px] text-gray-500 mb-4">{hint}</p>

        {/* Capture gallery */}
        {captures.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-2">
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
                        <span className="text-[10px] text-gray-400 font-semibold mt-1">
                          PDF
                        </span>
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
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add more button in the grid */}
              <button
                onClick={handleCameraCapture}
                className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 bg-white active:bg-gray-50"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-gray-400"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="text-[10px] text-gray-400 font-semibold">
                  Add
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Source buttons */}
        <div className="flex gap-3 mb-2">
          <button
            onClick={handleCameraCapture}
            className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-white border-[1.5px] border-gray-200 rounded-2xl active:bg-gray-50 active:shadow-lg transition-all"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-green-600"
            >
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[14px] font-semibold text-gray-900">
              Take Photo
            </span>
          </button>
          <button
            onClick={handleFilePick}
            className="flex-1 flex items-center justify-center gap-2.5 py-4 bg-white border-[1.5px] border-gray-200 rounded-2xl active:bg-gray-50 active:shadow-lg transition-all"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-green-600"
            >
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span className="text-[14px] font-semibold text-gray-900">
              Choose Files
            </span>
          </button>
        </div>

        {captures.length === 0 && (
          <p className="text-[12px] text-gray-400 text-center mt-2">
            You can add multiple pages or files for this document.
          </p>
        )}

        {/* Hidden file inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleCameraFile}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          multiple
          className="hidden"
          onChange={handleDeviceFiles}
        />
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
  const pinchRef = useRef({
    active: false,
    initialDist: 0,
    initialScale: 1,
  });
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

    function onGestureStart(e: any) {
      e.preventDefault();
      pinchRef.current = { active: true, initialDist: 0, initialScale: scale };
    }
    function onGestureChange(e: any) {
      e.preventDefault();
      setScale(
        Math.max(0.5, Math.min(5, pinchRef.current.initialScale * e.scale))
      );
    }
    function onGestureEnd(e: any) {
      e.preventDefault();
      pinchRef.current.active = false;
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchRef.current = {
          active: true,
          initialDist: Math.hypot(dx, dy),
          initialScale: scale,
        };
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const s = dist / pinchRef.current.initialDist;
        setScale(Math.max(0.5, Math.min(5, pinchRef.current.initialScale * s)));
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchRef.current.active = false;
    }

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
      {/* Top bar */}
      <div className="flex items-center justify-end px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
        {scale !== 1 && (
          <button
            onClick={() => setScale(1)}
            className="mr-auto px-3 py-1 rounded-full bg-white/10 text-white/80 text-[11px] font-mono font-bold active:bg-white/20"
          >
            {Math.round(scale * 100)}% — tap to reset
          </button>
        )}
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto overscroll-contain flex items-center justify-center"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <img
          src={imgSrc}
          alt="Document"
          className="max-w-full max-h-full object-contain transition-transform duration-100"
          style={{ transform: `scale(${scale})`, touchAction: "pan-x pan-y" }}
        />
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
        if (w > h) {
          h = Math.round((h * MAX) / w);
          w = MAX;
        } else {
          w = Math.round((w * MAX) / h);
          h = MAX;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const result = canvas.toDataURL("image/jpeg", 0.85);
      resolve(result.split(",")[1]);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
