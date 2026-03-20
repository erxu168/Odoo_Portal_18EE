'use client';

import React, { useRef, useState } from 'react';

/**
 * SwipeToDelete — iOS-style swipe-to-reveal delete button.
 * Wrap any list item with this component.
 *
 * Usage:
 *   <SwipeToDelete onDelete={() => handleDelete(id)} label="Delete">
 *     <div>Your list item content</div>
 *   </SwipeToDelete>
 */
interface SwipeToDeleteProps {
  children: React.ReactNode;
  onDelete: () => void;
  label?: string;
  disabled?: boolean;
}

export default function SwipeToDelete({ children, onDelete, label = 'Delete', disabled = false }: SwipeToDeleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const touchStart = useRef({ x: 0, y: 0, time: 0 });
  const isHorizontal = useRef<boolean | null>(null);

  const DELETE_WIDTH = 80;
  const THRESHOLD = 40;

  function handleTouchStart(e: React.TouchEvent) {
    if (disabled) return;
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
    isHorizontal.current = null;
    setSwiping(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swiping || disabled) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;

    // Determine swipe direction on first significant move
    if (isHorizontal.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }

    if (!isHorizontal.current) return; // vertical scroll, ignore

    e.preventDefault(); // prevent vertical scroll while swiping horizontally

    // Only allow left swipe (negative dx)
    const newOffset = Math.min(0, Math.max(-DELETE_WIDTH, dx + (offset < -THRESHOLD ? -DELETE_WIDTH : 0)));
    setOffset(newOffset);
  }

  function handleTouchEnd() {
    if (!swiping || disabled) return;
    setSwiping(false);
    isHorizontal.current = null;

    // Snap open or closed
    if (offset < -THRESHOLD) {
      setOffset(-DELETE_WIDTH);
    } else {
      setOffset(0);
    }
  }

  function handleDelete() {
    setOffset(0);
    onDelete();
  }

  function close() {
    setOffset(0);
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl mb-2.5"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Delete button behind */}
      <div
        className="absolute top-0 right-0 bottom-0 flex items-center justify-center bg-red-500 text-white font-bold text-[13px]"
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

      {/* Sliding content */}
      <div
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? 'none' : 'transform 0.25s ease-out',
        }}
        onClick={() => { if (offset < 0) { close(); } }}
      >
        {children}
      </div>
    </div>
  );
}
