'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Full-screen in-browser camera capture (getUserMedia) — used on desktop, where
 * a file input's `capture` attribute is ignored and cannot reach the webcam.
 * Preview is mirrored (natural for a selfie); the captured JPEG is un-mirrored.
 * Requires a secure context (HTTPS).
 *
 * `doneRef` guards every async path: it is reset on each effect run (so React
 * StrictMode's mount/unmount/mount cycle re-arms cleanly) and set true on close,
 * capture, or unmount so a late getUserMedia/toBlob callback can never fire after
 * the modal is gone or upload twice.
 */
interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraCaptureModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => {
    // Run-local flag: true once THIS effect's cleanup ran. React StrictMode mounts
    // the effect twice; a stale run must ignore its OWN late getUserMedia result
    // rather than consult the shared doneRef (which the second run resets to false).
    let cancelled = false;
    doneRef.current = false;

    async function start() {
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        if (!cancelled) setError('The camera needs a secure (https) connection here. Use Photos or Files instead.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setError('This browser cannot open the camera here. Use Photos or Files instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {}); // readiness is driven by onCanPlay
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera in your browser, or use Photos or Files instead.'
            : 'Could not open the camera. Use Photos or Files instead.',
        );
      }
    }

    start();
    return () => { cancelled = true; doneRef.current = true; stopStream(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capture() {
    if (capturing || doneRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h || video.readyState < 2) return; // 2 = HAVE_CURRENT_DATA (a frame is available)
    setCapturing(true);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setCapturing(false); return; }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (doneRef.current) return;            // modal closed while encoding
      if (!blob) { setCapturing(false); return; }
      const file = new File([blob], `camera-${w}x${h}.jpg`, { type: 'image/jpeg' });
      doneRef.current = true;                 // block any further callbacks / double-capture
      stopStream();
      onCapture(file);
    }, 'image/jpeg', 0.9);
  }

  function handleClose() {
    doneRef.current = true;
    stopStream();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-white font-semibold text-[14px]">Take a photo</span>
        <button onClick={handleClose} aria-label="Close camera"
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {error ? (
          <div className="text-center px-8">
            <div className="text-white/80 text-[14px] leading-relaxed mb-4">{error}</div>
            <button onClick={handleClose} className="h-11 px-5 rounded-xl bg-white text-gray-900 font-bold text-[14px] active:opacity-85">
              Use Photos or Files
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onCanPlay={() => { if (!doneRef.current) setReady(true); }}
            className="max-h-full max-w-full object-contain -scale-x-100"
          />
        )}
      </div>

      {!error && (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <button onClick={capture} disabled={!ready || capturing} aria-label="Capture photo"
            className="w-16 h-16 rounded-full bg-white ring-4 ring-white/30 active:scale-95 transition-transform disabled:opacity-40" />
          {!ready && <span className="text-white/50 text-[12px]">Starting camera…</span>}
        </div>
      )}
    </div>
  );
}
