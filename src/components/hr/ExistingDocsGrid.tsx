"use client";

import React from "react";

export interface ExistingDoc {
  id: number;
  name: string;
  doc_type_key: string;
  mimetype?: string;
}

export interface ThumbnailData {
  base64: string;
  mimetype: string;
}

interface ExistingDocsGridProps {
  docs: ExistingDoc[];
  thumbnails: Record<number, ThumbnailData>;
  loadingViewerId: number | null;
  onView: (doc: ExistingDoc) => void;
  onDeleteRequest: (doc: ExistingDoc) => void;
}

/** Grid of existing uploaded documents with thumbnails */
export default function ExistingDocsGrid({
  docs,
  thumbnails,
  loadingViewerId,
  onView,
  onDeleteRequest,
}: ExistingDocsGridProps) {
  if (docs.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
        Currently uploaded ({docs.length})
      </div>
      <div className="grid grid-cols-3 gap-2.5 mb-2">
        {docs.map((doc) => {
          const thumb = thumbnails[doc.id];
          const isImage = thumb && !thumb.mimetype.includes("pdf");
          const isPdf = thumb && thumb.mimetype === "application/pdf";
          const isLoading = loadingViewerId === doc.id;

          return (
            <button
              key={doc.id}
              onClick={() => onView(doc)}
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
                onClick={(e) => { e.stopPropagation(); onDeleteRequest(doc); }}
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
  );
}
