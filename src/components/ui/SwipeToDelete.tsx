'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';

/**
 * SwipeToDelete — iOS-style swipe-to-reveal delete button.
 * Works on iOS Safari + Android Chrome.
 *
 * Uses native touch event listeners with { passive: false }
 * because React synthetic events are passive by default —
 * preventDefault() doesn't work on passive listeners,
 * causing the browser to intercept horizontal swipes.
 *
 * Usage:
 *   <SwipeToDelete onDelete={() => handleDelete(id)}>
 *     <div>Your list item</div>
 *   </SwipeToDelete>
 */
interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  label?: string;
  disabled?: boolean;
}

export default function SwipeToDelete({ children, onDelete, label = 'Delete', disabled = false }: SwipeToDeleteProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const currentOffset = useRef(0);
  const direction = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const tracking = useRef(false);

  const DELETE_WIDTH = 80;
  const SNAP_THRESHOLD = 30;

  // Keep offset ref in sync
  useEffect(() => { currentOffset.current = offset; }, [offset]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (disabled) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    direction.current = 'none';
    tracking.current = true;
  }, [disabled]);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!tracking.current || disabled) return;

    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Determine direction on first significant move
    if (direction.current === 'none') {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        direction.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      return;
    }

    // Vertical scroll — let browser handle it
    if (direction.current === 'vertical') return;

    // Horizontal swipe — we handle it
    e.preventDefault(); // This works because listener is { passive: false }

    // Calculate new position
    const base = open ? -DELETE_WIDTH : 0;
    const raw = base + dx;
    const clamped = Math.min(0, Math.max(-DELETE_WIDTH - 20, raw)); // slight overswipe allowed
    setOffset(clamped);
  }, [disabled, open]);

  const onTouchEnd = useCallback(() => {
    if (!tracking.current || disabled) return;
    tracking.current = false;
    direction.current = 'none';

    // Snap decision
    if (currentOffset.current < -SNAP_THRESHOLD) {
      setOffset(-DELETE_WIDTH);
      setOpen(true);
    } else {
      setOffset(0);
      setOpen(false);
    }
  }, [disabled]);

  // Attach native listeners with { passive: false }
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false }); // KEY: non-passive
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  function handleDelete() {
    setOffset(0);
    setOpen(false);
    onDelete();
  }

  function close() {
    setOffset(0);
    setOpen(false);
  }

  return (
    <div ref={rowRef} className="relative overflow-hidden rounded-xl mb-2.5" style={{ touchAction: 'pan-y' }}>
      {/* Red delete button behind the content */}
      <div
        className="absolute top-0 right-0 bottom-0 flex items-center justify-center bg-red-500 text-white font-bold text-[13px] cursor-pointer active:bg-red-600"
        style={{ width: DELETE_WIDTH }}
        onClick={handleDelete}
      >
        <div className="flex flex-col items-center gap-0.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          {label}
        </div>
      </div>

      {/* Sliding content layer */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: tracking.current ? 'none' : 'transform 0.25s ease-out',
        }}
        onClick={() => { if (open) { close(); } }}
      >
        {children}
      </div>
    </div>
  );
}
