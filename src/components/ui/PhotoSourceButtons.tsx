'use client';

import React, { useRef, useState } from 'react';
import CameraCaptureModal from '@/components/ui/CameraCaptureModal';

/**
 * Three-source photo picker (Take photo · Photo library · Choose file).
 *
 * Each button is a hidden <input type="file">, the only way a browser can read a
 * local file. The three differ mainly on mobile:
 *   - Take photo   : capture="user"  → phone opens the front camera; on desktop
 *                     `capture` is ignored, so it falls back to the file dialog.
 *   - Photo library: accept="image/*" (no capture) → phone shows the gallery;
 *                     desktop opens the file browser filtered to images.
 *   - Choose file  : accept="image/*" (no capture) → phone shows the Files app;
 *                     desktop opens the file browser.
 * On a Mac all three converge on Finder (no OS gallery concept in the browser).
 */
interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * Phones/tablets have a native camera app worth using; desktops (incl. touchscreen
 * Windows laptops) need the in-browser webcam. Match real mobile/tablet UAs; treat
 * iPadOS (reports as "Macintosh" but has touch points) as mobile — but do NOT
 * classify a touchscreen Windows laptop or Chromebook as mobile.
 */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS;
}

export default function PhotoSourceButtons({ onFile, disabled = false }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  function openCamera() {
    // Phone → native camera (higher quality, familiar UI). Desktop → webcam modal.
    if (isMobileDevice()) cameraRef.current?.click();
    else setShowCamera(true);
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = ''; // allow re-picking the same file
  }

  const btn =
    'flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 py-3 px-1 bg-white border-[1.5px] border-gray-200 rounded-xl active:bg-gray-50 active:shadow disabled:opacity-40 transition-all';
  const label = 'text-[12px] font-semibold text-gray-900 leading-tight text-center';

  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={openCamera} disabled={disabled} className={btn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className={label}>Camera</span>
        </button>

        <button type="button" onClick={() => galleryRef.current?.click()} disabled={disabled} className={btn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span className={label}>Photos</span>
        </button>

        <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} className={btn}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span className={label}>Files</span>
        </button>
      </div>

      {/* Hidden inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={pick} disabled={disabled} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={pick} disabled={disabled} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} disabled={disabled} />

      {showCamera && (
        <CameraCaptureModal
          onCapture={(f) => { setShowCamera(false); onFile(f); }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </>
  );
}
