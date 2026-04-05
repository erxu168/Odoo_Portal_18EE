"use client";

import React from "react";
import FilePicker from "@/components/ui/FilePicker";
import type { CapturedFile } from "./CapturePreview";

interface NewCapturesGridProps {
  captures: CapturedFile[];
  onPreview: (index: number) => void;
  onRemove: (id: string) => void;
  onFilePicked: (file: File, dataUrl: string) => void;
}

/** Grid of newly captured files with preview thumbnails and add-more button */
export default function NewCapturesGrid({
  captures,
  onPreview,
  onRemove,
  onFilePicked,
}: NewCapturesGridProps) {
  if (captures.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
        New captures ({captures.length})
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {captures.map((cap, idx) => (
          <div key={cap.id} className="relative aspect-square">
            <button
              onClick={() => onPreview(idx)}
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
                onRemove(cap.id);
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
  );
}
