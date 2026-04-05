"use client";

import React from "react";

export interface CapturedFile {
  id: string;
  dataUrl: string;
  isPdf: boolean;
}

interface CapturePreviewProps {
  capture: CapturedFile;
  index: number;
  total: number;
  onRemove: (id: string) => void;
  onRetake: (id: string) => void;
  onClose: () => void;
}

/** Full-screen preview of a single new capture with delete/retake actions */
export default function CapturePreview({
  capture,
  index,
  total,
  onRemove,
  onRetake,
  onClose,
}: CapturePreviewProps) {
  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 backdrop-blur-sm flex-shrink-0">
        <span className="text-white/60 text-[var(--fs-sm)] font-mono">
          {index + 1} / {total}
        </span>
        <button
          onClick={onClose}
          className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-full bg-white/10 flex items-center justify-center active:bg-white/20"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Image */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
        {capture.isPdf ? (
          <div className="bg-white rounded-xl p-8 text-center">
            <div className="text-5xl mb-3">{"\u{1F4C4}"}</div>
            <div className="text-[var(--fs-md)] font-bold text-gray-900">PDF document</div>
          </div>
        ) : (
          <img
            src={capture.dataUrl}
            alt={`Page ${index + 1}`}
            className="max-w-full max-h-[70vh] rounded-xl object-contain"
          />
        )}
      </div>

      {/* Actions */}
      <div className="p-4 pb-8 flex gap-3">
        <button
          onClick={() => onRemove(capture.id)}
          className="flex-1 py-4 bg-red-500/20 text-red-400 font-semibold rounded-xl active:opacity-85 flex items-center justify-center gap-2"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Delete
        </button>
        <button
          onClick={() => onRetake(capture.id)}
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
