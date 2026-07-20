'use client';

import { useRef } from 'react';

export interface ImagePin {
  /** Fraction across the image, 0–1. */
  pin_x: number;
  /** Fraction down the image, 0–1. */
  pin_y: number;
  /** Optional label, shown as a tooltip / aria-label. Numbering comes from array order. */
  label?: string;
  done?: boolean;
}

interface Props {
  src: string;
  pins: ImagePin[];
  mode: 'view' | 'edit';
  /** Highlighted pin index (0-based), e.g. the row the user is hovering in the list. */
  activeIndex?: number | null;
  /** view: user tapped pin #index. */
  onPinClick?: (index: number) => void;
  /** edit: user tapped an empty spot — coordinates are fractions (0–1), already clamped. */
  onPlace?: (x: number, y: number) => void;
  onImageError?: () => void;
  className?: string;
}

/**
 * Shared image-with-numbered-pins primitive for setup guides.
 *
 * The wrapper shrink-wraps the <img> (inline-block, image is max-w-full/h-auto),
 * so the pin overlay's percentage coordinates always map to the DISPLAYED image
 * bounds — no letterboxing, and `object-fit: contain` is unnecessary because the
 * container never grows past the image. Coordinates are stored as fractions so
 * they survive different phone/tablet sizes.
 */
export default function PinnableImage({
  src, pins, mode, activeIndex = null, onPinClick, onPlace, onImageError, className = '',
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode !== 'edit' || !onPlace) return;
    // Ignore taps that land on an existing pin button (they stopPropagation, but guard anyway).
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onPlace(x, y);
  }

  return (
    <div
      ref={wrapRef}
      onClick={handleClick}
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
        return (
          <button
            key={i}
            type="button"
            title={p.label}
            aria-label={p.label ? `Pin ${i + 1}: ${p.label}` : `Pin ${i + 1}`}
            onClick={(e) => { e.stopPropagation(); onPinClick?.(i); }}
            style={{ left: `${p.pin_x * 100}%`, top: `${p.pin_y * 100}%` }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-white shadow-md font-bold text-xs transition-transform ${
              p.done
                ? 'bg-green-500 text-white'
                : active
                  ? 'bg-orange-600 text-white scale-125 ring-2 ring-orange-300'
                  : 'bg-orange-500 text-white'
            }`}
          >
            {/* 28px visible circle inside a 44px touch target for accessibility. */}
            <span className="absolute -inset-[8px]" aria-hidden="true" />
            <span className="w-7 h-7 flex items-center justify-center">
              {p.done ? '✓' : i + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
