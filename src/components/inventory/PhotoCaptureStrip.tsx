'use client';

import React, { useRef, useState } from 'react';

const DEFAULT_MAX_PHOTOS = 3;
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.7;

interface PhotoCaptureStripProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
  /** Cap on how many photos can be attached. Defaults to 3. */
  max?: number;
}

/**
 * Capture up to `max` photos inline (default 3). Stores each photo as
 * a JPEG base64 dataURL, compressed to max 1280px on the long edge at
 * 0.7 quality. Caller owns the photos state; this component just
 * renders + emits.
 */
export default function PhotoCaptureStrip({ photos, onChange, disabled, max = DEFAULT_MAX_PHOTOS }: PhotoCaptureStripProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      if (dataUrl) onChange([...photos, dataUrl]);
    } finally {
      setBusy(false);
    }
  }

  function remove(idx: number) {
    const next = [...photos];
    next.splice(idx, 1);
    onChange(next);
  }

  const atMax = photos.length >= max;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {photos.map((p, i) => (
        <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
          <img src={p} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center active:bg-black disabled:opacity-50"
            aria-label="Remove photo"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      ))}
      {!atMax && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
            disabled={disabled || busy}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="w-14 h-14 rounded-lg border-2 border-dashed border-[#F5800A] text-[#F5800A] flex items-center justify-center active:bg-[#FFF4E6] disabled:opacity-50"
            aria-label={photos.length === 0 ? 'Add photo' : 'Add another photo'}
          >
            {busy ? (
              <div className="w-4 h-4 border-2 border-[#F5800A]/30 border-t-[#F5800A] rounded-full animate-spin" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  );
}

async function fileToResizedDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const { width: w, height: h } = fitWithin(img.width, img.height, MAX_DIMENSION);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: max, height: Math.round(max / ratio) };
  return { width: Math.round(max * ratio), height: max };
}
