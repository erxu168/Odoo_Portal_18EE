"use client";

import React, { useState, useEffect } from "react";
import AppHeader from "@/components/ui/AppHeader";
import PdfViewer from "@/components/ui/PdfViewer";
import type { DocumentType } from "@/types/hr";

interface CapturedImage {
  slotKey: string;
  dataUrl: string;
}

interface UploadedDoc {
  id: number;
  name: string;
  doc_type_key: string;
}

interface Props {
  docType: DocumentType;
  onBack: () => void;
  onSaved: () => void;
}

const SLOT_CONFIG: Record<string, { key: string; label: string }[]> = {
  ausweis: [
    { key: "front", label: "Front side" },
    { key: "back", label: "Back side" },
  ],
  aufenthaltstitel: [
    { key: "front", label: "Front side" },
    { key: "back", label: "Back side" },
    { key: "visa_sticker", label: "Visa sticker page" },
  ],
  steuer_id: [{ key: "page", label: "Tax ID letter" }],
  sv_ausweis: [{ key: "page", label: "SV Card" }],
  gesundheitszeugnis: [{ key: "page", label: "Health certificate" }],
  krankenkasse: [{ key: "page", label: "Insurance confirmation" }],
  lohnsteuer: [{ key: "page", label: "Tax certificate" }],
  vertrag: [{ key: "page", label: "Contract document" }],
};

export default function DocumentCapture({ docType, onBack, onSaved }: Props) {
  const [captures, setCaptures] = useState<CapturedImage[]>([]);
  const [preview, setPreview] = useState<{ slotKey: string; dataUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [existingDoc, setExistingDoc] = useState<UploadedDoc | null>(null);

  // Inline viewer state
  const [viewerData, setViewerData] = useState<{ base64: string; mimetype: string } | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);

  const slots = SLOT_CONFIG[docType.key] || [{ key: "page", label: "Document" }];

  useEffect(() => {
    fetch("/api/hr/documents")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.documents || []).find(
          (doc: UploadedDoc) => doc.doc_type_key === docType.key
        );
        if (found) setExistingDoc(found);
      })
      .catch(() => {});
  }, [docType.key]);

  function getCaptureForSlot(slotKey: string): CapturedImage | undefined {
    return captures.find((c) => c.slotKey === slotKey);
  }

  function handleCapture(slotKey: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,.pdf";
    input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPreview({ slotKey, dataUrl });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function confirmPreview() {
    if (!preview) return;
    setCaptures((prev) => {
      const filtered = prev.filter((c) => c.slotKey !== preview.slotKey);
      return [...filtered, { slotKey: preview.slotKey, dataUrl: preview.dataUrl }];
    });
    setPreview(null);
  }

  function retakePreview() {
    if (!preview) return;
    const slotKey = preview.slotKey;
    setPreview(null);
    setTimeout(() => handleCapture(slotKey), 100);
  }

  function removeCapture(slotKey: string) {
    setCaptures((prev) => prev.filter((c) => c.slotKey !== slotKey));
  }

  async function handleSave() {
    if (captures.length === 0) return;
    setUploading(true);
    try {
      const images: string[] = [];
      for (const cap of captures) {
        if (cap.dataUrl.includes("application/pdf")) {
          images.push(cap.dataUrl.split(",")[1]);
        } else {
          const compressed = await compressImage(cap.dataUrl);
          images.push(compressed);
        }
      }
      const finalBase64 = images.length === 1 ? images[0] : images[0];
      const ext = captures[0].dataUrl.includes("application/pdf") ? ".pdf" : ".jpg";
      const filename = docType.key + "_" + new Date().toISOString().slice(0, 10) + ext;
      const res = await fetch("/api/hr/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type_key: docType.key,
          filename,
          data_base64: finalBase64,
        }),
      });
      if (res.ok) {
        onSaved();
      }
    } catch (_e: unknown) {
      console.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleViewExisting() {
    if (!existingDoc) return;
    setLoadingViewer(true);
    try {
      const res = await fetch("/api/hr/documents/" + existingDoc.id);
      if (res.ok) {
        const data = await res.json();
        setViewerData({ base64: data.data_base64, mimetype: data.mimetype });
      }
    } catch (_e: unknown) {
      console.error("Failed to load document");
    } finally {
      setLoadingViewer(false);
    }
  }

  // Inline overlay viewer
  if (viewerData) {
    const isPdf = viewerData.mimetype === "application/pdf";
    if (isPdf) {
      return (
        <PdfViewer
          fileData={viewerData.base64}
          fileName={existingDoc?.name}
          onClose={() => setViewerData(null)}
        />
      );
    }
    // Image overlay with pinch-zoom
    return <ImageOverlay base64={viewerData.base64} mimetype={viewerData.mimetype} onClose={() => setViewerData(null)} />;
  }

  if (preview) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          {preview.dataUrl.includes("application/pdf") ? (
            <div className="bg-white rounded-xl p-8 text-center">
              <div className="text-4xl mb-2">{"\u{1F4C4}"}</div>
              <div className="text-[14px] font-semibold">PDF file selected</div>
            </div>
          ) : (
            <img
              src={preview.dataUrl}
              alt="Preview"
              className="max-w-full max-h-[70vh] rounded-xl object-contain"
            />
          )}
        </div>
        <div className="p-4 pb-8 text-center">
          <p className="text-white/70 text-[13px] mb-4">
            Make sure all text is readable, no blur, and good lighting.
          </p>
          <div className="flex gap-3">
            <button
              onClick={retakePreview}
              className="flex-1 py-4 bg-white/20 text-white font-semibold rounded-xl active:opacity-85"
            >
              Retake
            </button>
            <button
              onClick={confirmPreview}
              className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85"
            >
              Use this photo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8faf9] pb-40">
      <AppHeader
        title={docType.label}
        subtitle={docType.labelDe}
        showBack
        onBack={onBack}
      />

      <div className="p-5">
        {existingDoc && (
          <button
            onClick={handleViewExisting}
            disabled={loadingViewer}
            className="w-full mb-4 p-4 bg-green-50 border border-green-600 rounded-2xl flex items-center gap-3 text-left active:shadow-lg disabled:opacity-60"
          >
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-[24px]">
              {"\u2713"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-green-700">
                Currently uploaded
              </div>
              <div className="text-[12px] text-green-600 mt-0.5">
                {existingDoc.name} &middot; Tap to view
              </div>
            </div>
            {loadingViewer && (
              <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
          </button>
        )}

        <p className="text-[13px] text-gray-500 mb-4">
          {slots.length > 1
            ? "This document requires multiple photos. Capture each side separately."
            : "Take a clear photo or select a file from your device."}
        </p>

        {slots.map((slot) => {
          const captured = getCaptureForSlot(slot.key);
          return (
            <div key={slot.key} className="mb-3">
              <div className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                {slot.label}
              </div>
              {captured ? (
                <div className="relative rounded-2xl overflow-hidden border-2 border-green-600">
                  {captured.dataUrl.includes("application/pdf") ? (
                    <div className="h-40 bg-gray-50 flex items-center justify-center">
                      <div className="text-4xl">{"\u{1F4C4}"}</div>
                    </div>
                  ) : (
                    <img
                      src={captured.dataUrl}
                      alt={slot.label}
                      className="w-full h-40 object-cover"
                    />
                  )}
                  <button
                    onClick={() => removeCapture(slot.key)}
                    className="absolute top-2 right-2 w-8 h-8 bg-black/60 text-white rounded-full flex items-center justify-center text-[16px] font-bold"
                  >
                    X
                  </button>
                  <button
                    onClick={() => handleCapture(slot.key)}
                    className="absolute bottom-2 right-2 px-3 py-1.5 bg-black/60 text-white rounded-lg text-[12px] font-semibold"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleCapture(slot.key)}
                  className="w-full h-40 border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center gap-2 bg-white active:bg-gray-50"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[24px]">
                    {"\u{1F4F7}"}
                  </div>
                  <span className="text-[13px] text-gray-500 font-medium">
                    Tap to capture
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

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
          className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40"
        >
          {uploading ? "Uploading..." : "Save document"}
        </button>
      </div>
    </div>
  );
}

/** Fullscreen image overlay with pinch-to-zoom */
function ImageOverlay({ base64, mimetype, onClose }: { base64: string; mimetype: string; onClose: () => void }) {
  const imgSrc = `data:${mimetype};base64,${base64}`;
  const [scale, setScale] = useState(1);
  const pinchRef = React.useRef({ active: false, initialDist: 0, initialScale: 1 });
  const containerRef = React.useRef<HTMLDivElement>(null);

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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
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
