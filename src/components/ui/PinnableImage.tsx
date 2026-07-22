'use client';

import { useRef, useState } from 'react';

export interface ImagePin {
  /** Fraction across the image, 0–1. */
  pin_x: number;
  /** Fraction down the image, 0–1. */
  pin_y: number;
  /** Optional label, shown as a tooltip / aria-label. Numbering comes from array order. */
  label?: string;
  done?: boolean;
  /** Optional display number (defaults to index+1) — lets multi-photo guides number pins globally. */
  number?: number;
}

interface Props {
  src: string;
  pins: ImagePin[];
  mode: 'view' | 'edit';
  /** Highlighted pin index (0-based), e.g. the row the user is hovering in the list. */
  activeIndex?: number | null;
  /** view: user tapped pin #index. edit: also fired on a tap (not a drag). */
  onPinClick?: (index: number) => void;
  /** edit: user tapped an empty spot — coordinates are fractions (0–1), already clamped. */
  onPlace?: (x: number, y: number) => void;
  /** edit: user dragged pin #index to a new spot — fired once on drop, clamped fractions. */
  onPinMove?: (index: number, x: number, y: number) => void;
  onImageError?: () => void;
  /** edit: freeze placement/drag while a save is in flight. A pointer captured
   * BEFORE the freeze still delivers move/up events to the captured element
   * (pointer capture bypasses `pointer-events:none`), so we must drop that
   * gesture here instead of committing a move after the parent snapshotted pins. */
  disabled?: boolean;
  className?: string;
}

/** Movement below this (px) counts as a tap, not a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Shared image-with-numbered-pins primitive for setup guides.
 *
 * The wrapper shrink-wraps the <img> (inline-block, image is max-w-full/h-auto),
 * so the pin overlay's percentage coordinates always map to the DISPLAYED image
 * bounds — no letterboxing. Coordinates are stored as fractions so they survive
 * different phone/tablet sizes.
 *
 * Edit mode: tap an empty spot to place a pin, DRAG a pin to move it. Pointer
 * events give one code path for mouse and touch; `touch-action: none` is set on
 * the pins ONLY, so page scrolling elsewhere keeps working (iOS pitfall #4).
 */
export default function PinnableImage({
  src, pins, mode, activeIndex = null, onPinClick, onPlace, onPinMove, onImageError, disabled = false, className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Live position of the pin being dragged (render-only; committed on drop).
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  const gesture = useRef<{ pointerId: number; index: number; startX: number; startY: number; moved: boolean } | null>(null);
  // Suppress the synthetic click that follows a drag's pointerup.
  const justDragged = useRef(false);

  function fractions(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleWrapClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode !== 'edit' || !onPlace || disabled) return;
    if (justDragged.current) { justDragged.current = false; return; }
    const f = fractions(e);
    if (f) onPlace(f.x, f.y);
  }

  function onPinPointerDown(index: number) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      if (mode !== 'edit' || !onPinMove || disabled) return;
      // Clear any stale suppression flag: on touch a drag's pointerup fires no
      // synthetic click, so the flag set on the previous drop could otherwise
      // swallow this fresh tap.
      justDragged.current = false;
      // One gesture at a time: a second finger on another pin is ignored.
      if (gesture.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { pointerId: e.pointerId, index, startX: e.clientX, startY: e.clientY, moved: false };
    };
  }

  function onPinPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return;
      g.moved = true;
    }
    const f = fractions(e);
    if (f) setDrag({ index: g.index, x: f.x, y: f.y });
  }

  function onPinPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    if (g.moved) {
      // A save started mid-drag: drop the move rather than commit it after the
      // parent snapshotted pins. Keep justDragged so the trailing click is eaten.
      if (disabled) { justDragged.current = true; setDrag(null); return; }
      const f = fractions(e);
      if (f && onPinMove) onPinMove(g.index, f.x, f.y);
      justDragged.current = true;
      setDrag(null);
    }
    // A no-move press falls through to the button's onClick (tap behaviour).
  }

  return (
    <div
      ref={wrapRef}
      onClick={handleWrapClick}
      className={`relative inline-block leading-none select-none ${mode === 'edit' ? 'cursor-crosshair' : ''} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Setup reference"
        onError={onImageError}
        className="block max-w-full h-auto rounded-lg"
        draggable={false}
      />
      {pins.map((p, i) => {
        const active = activeIndex === i;
        const dragging = drag?.index === i;
        const x = dragging ? drag.x : p.pin_x;
        const y = dragging ? drag.y : p.pin_y;
        return (
          <button
            key={i}
            type="button"
            title={p.label}
            aria-label={p.label ? `Pin ${p.number ?? i + 1}: ${p.label}` : `Pin ${p.number ?? i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              if (justDragged.current) { justDragged.current = false; return; }
              onPinClick?.(i);
            }}
            onPointerDown={onPinPointerDown(i)}
            onPointerMove={onPinPointerMove}
            onPointerUp={onPinPointerUp}
            onPointerCancel={(e) => {
              if (gesture.current && e.pointerId === gesture.current.pointerId) {
                gesture.current = null; setDrag(null);
              }
            }}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              // Disable scroll/zoom gestures ON the pin only, so a finger can drag it.
              touchAction: mode === 'edit' ? 'none' : undefined,
            }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-white shadow-md font-bold text-xs ${
              dragging ? 'scale-125 cursor-grabbing z-10' : mode === 'edit' ? 'cursor-grab transition-transform' : 'transition-transform'
            } ${
              p.done
                ? 'bg-green-500 text-white'
                : active || dragging
                  ? 'bg-orange-600 text-white scale-125 ring-2 ring-orange-300'
                  : 'bg-orange-500 text-white'
            }`}
          >
            {/* 28px visible circle inside a 44px touch target for accessibility. */}
            <span className="absolute -inset-[8px]" aria-hidden="true" />
            <span className="w-7 h-7 flex items-center justify-center">
              {p.done ? '✓' : p.number ?? i + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
