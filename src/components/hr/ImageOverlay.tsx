"use client";

import React, { useState, useEffect, useRef } from "react";

interface ImageOverlayProps {
  base64: string;
  mimetype: string;
  onClose: () => void;
}

/** Fullscreen image overlay with pinch-to-zoom */
export default function ImageOverlay({
  base64,
  mimetype,
  onClose,
}: ImageOverlayProps) {
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
