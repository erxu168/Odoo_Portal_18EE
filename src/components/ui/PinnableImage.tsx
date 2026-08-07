'use client';

import { useEffect, useRef, useState } from 'react';
import DrawingLayer from './DrawingLayer';
import type { GuideDrawing, GuideDrawingType } from '@/lib/guide-drawings';

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
  /** Accessible description of the image (falls back to a generic label). */
  alt?: string;
  /** view: show the active pin's label as a popover anchored at the dot. */
  notePopover?: boolean;
  /** view: user tapped the image background — clear the open note. */
  onClearActive?: () => void;
  /** Extra classes for the <img> (e.g. a max-height so the photo fills more space). */
  imgClassName?: string;
  /** Author-drawn marks over the photo (arrow/circle/box/pen), rendered under the pins. */
  drawings?: GuideDrawing[];
  /** edit: the active drawing tool — when set, drawing captures the gesture
   * INSTEAD of placing pins (so a drag can't also drop a pin). */
  drawTool?: GuideDrawingType | null;
  /** edit: stroke colour for new marks. */
  drawColor?: string;
  /** edit: line weight LEVEL (1..5) for new marks. */
  drawWidth?: number;
  /** edit: the words a new TEXT mark will carry. */
  drawText?: string;
  /** edit: a mark was finished. */
  onDrawAdd?: (shape: GuideDrawing) => void;
  /** edit: index of the selected mark (tap-to-select), or null. */
  drawSelected?: number | null;
  /** edit: the selection changed. */
  onDrawSelect?: (index: number | null) => void;
  /** edit: a mark was moved or stretched. */
  onDrawUpdate?: (index: number, shape: GuideDrawing) => void;
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
  src, pins, mode, activeIndex = null, onPinClick, onPlace, onPinMove, onImageError, disabled = false, className = '', alt,
  notePopover = false, onClearActive, imgClassName = '',
  drawings, drawTool = null, drawColor = '#DC2626', drawWidth, drawText = '', onDrawAdd,
  drawSelected = null, onDrawSelect, onDrawUpdate,
}: Props) {
  // While a drawing tool is active the drawing layer owns the gesture, so a
  // drag can't also drop a pin underneath it.
  const drawingActive = mode === 'edit' && !!drawTool;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Live position of the pin being dragged (render-only; committed on drop).
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  const gesture = useRef<{ pointerId: number; index: number; startX: number; startY: number; moved: boolean } | null>(null);
  // Suppress the synthetic click that follows a drag's pointerup.
  const justDragged = useRef(false);

  // View-mode note popover, anchored at the active pin. It flips above/below the
  // dot and clamps horizontally so it never leaves the photo — feels attached to
  // the spot it describes, unlike a detached bottom sheet.
  const popRef = useRef<HTMLDivElement>(null);
  const [notePos, setNotePos] = useState<{ left: number; top: number; below: boolean; arrowLeft: number } | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const notePin = mode === 'view' && notePopover && activeIndex != null ? pins[activeIndex] : undefined;
  const noteLabel = notePin?.label;
  const noteAx = notePin?.pin_x ?? 0;
  const noteAy = notePin?.pin_y ?? 0;

  useEffect(() => {
    if (!noteLabel) { setNotePos(null); return; }
    const wrap = wrapRef.current, pop = popRef.current;
    if (!wrap || !pop) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const pr = pop.getBoundingClientRect();
    const dotX = W * noteAx, dotY = H * noteAy;
    // Dot in the upper half → note below it; lower half → above it. Keeps the
    // note next to the dot and on-screen.
    const below = noteAy < 0.55;
    let left = dotX - pr.width / 2;
    left = Math.max(6, Math.min(left, Math.max(6, W - pr.width - 6)));
    const top = below ? dotY + 22 : dotY - 22 - pr.height;
    let arrowLeft = dotX - left;
    arrowLeft = Math.max(14, Math.min(arrowLeft, pr.width - 14));
    setNotePos({ left, top, below, arrowLeft });
  }, [noteLabel, noteAx, noteAy, resizeTick]);

  useEffect(() => {
    if (!noteLabel) return;
    const on = () => setResizeTick(t => t + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [noteLabel]);

  // If a save freezes the editor mid-gesture, VOID the captured drag immediately.
  // Otherwise a pointer released later — even after a failed save re-enables the
  // editor (disabled back to false) — would commit a move made before the save
  // snapshot. Clearing gesture.current now makes the eventual pointerup a no-op.
  useEffect(() => {
    if (disabled && gesture.current) { gesture.current = null; setDrag(null); }
  }, [disabled]);

  function fractions(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleWrapClick(e: React.MouseEvent<HTMLDivElement>) {
    // View mode: a tap on the photo background dismisses an open note.
    if (mode === 'view') { onClearActive?.(); return; }
    // A drawing tool is active — the tap belongs to the drawing layer.
    if (drawingActive) return;
    if (!onPlace || disabled) return;
    if (justDragged.current) { justDragged.current = false; return; }
    const f = fractions(e);
    if (f) onPlace(f.x, f.y);
  }

  function onPinPointerDown(index: number) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      // A drawing tool owns every gesture on the photo: without this, starting a
      // stroke on top of a pin would DRAG THE PIN instead of drawing.
      if (drawingActive) return;
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
      className={`relative inline-block leading-none select-none ${mode === 'edit' && !drawingActive ? 'cursor-crosshair' : ''} ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || 'Guide photo'}
        onError={onImageError}
        className={`block max-w-full h-auto rounded-lg ${imgClassName}`}
        draggable={false}
      />
      {/* Drawn marks sit ABOVE the photo but BELOW the pins, so a numbered dot
          is never hidden by a scribble. */}
      {((drawings && drawings.length > 0) || drawingActive) && (
        <DrawingLayer
          shapes={drawings || []}
          mode={drawingActive ? 'draw' : 'view'}
          tool={drawTool || 'arrow'}
          color={drawColor}
          width={drawWidth}
          text={drawText}
          onAdd={onDrawAdd}
          selectedIndex={drawSelected}
          onSelect={onDrawSelect}
          onUpdate={onDrawUpdate}
          disabled={disabled}
        />
      )}
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
            tabIndex={drawingActive ? -1 : undefined}
            onClick={(e) => {
              if (drawingActive) return;
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
            onKeyDown={(e) => {
              // Keyboard nudge — makes pins operable without a pointer (WCAG 2.1.1).
              if (mode !== 'edit' || !onPinMove || disabled) return;
              const STEP = e.shiftKey ? 0.05 : 0.01;
              let dx = 0, dy = 0;
              if (e.key === 'ArrowLeft') dx = -STEP;
              else if (e.key === 'ArrowRight') dx = STEP;
              else if (e.key === 'ArrowUp') dy = -STEP;
              else if (e.key === 'ArrowDown') dy = STEP;
              else return;
              e.preventDefault();
              onPinMove(i, Math.min(1, Math.max(0, x + dx)), Math.min(1, Math.max(0, y + dy)));
            }}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              // Disable scroll/zoom gestures ON the pin only, so a finger can drag it.
              touchAction: mode === 'edit' ? 'none' : undefined,
              // While drawing, pins are decorative: let the gesture fall straight
              // through to the drawing layer beneath them.
              pointerEvents: drawingActive ? 'none' : undefined,
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
            {/* Draw the eye: an unopened view-mode marker gently pings so staff
                know it's tappable. Stops once opened (active) or done. */}
            {mode === 'view' && !active && !p.done && (
              <span className="absolute inset-0 rounded-full bg-orange-400 opacity-70 motion-safe:animate-ping" aria-hidden="true" />
            )}
            <span className="relative w-7 h-7 flex items-center justify-center">
              {p.done ? '✓' : p.number ?? i + 1}
            </span>
          </button>
        );
      })}
      {noteLabel && (
        <div
          ref={popRef}
          role="note"
          onClick={(e) => e.stopPropagation()}
          style={{
            left: notePos?.left ?? 0,
            top: notePos?.top ?? 0,
            maxWidth: 'min(240px, 80%)',
            minWidth: 116,
            visibility: notePos ? 'visible' : 'hidden',
          }}
          className="absolute z-20 rounded-xl bg-white shadow-lg ring-1 ring-black/5"
        >
          <div className="flex items-start gap-1.5 px-3 py-2.5">
            <span className="mt-[1px] flex-shrink-0 w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center">
              {(activeIndex ?? 0) + 1}
            </span>
            <span className="text-sm leading-snug text-gray-800 whitespace-pre-wrap break-words">{noteLabel}</span>
          </div>
          {notePos && (
            <span
              aria-hidden="true"
              className="absolute"
              style={{
                left: notePos.arrowLeft - 7,
                ...(notePos.below ? { top: -7 } : { bottom: -7 }),
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                ...(notePos.below ? { borderBottom: '7px solid #ffffff' } : { borderTop: '7px solid #ffffff' }),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
