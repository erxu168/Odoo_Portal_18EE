'use client';

import React, { useId } from 'react';
import { LEVEL_FRACTIONS, type LevelFraction } from '@/lib/crate-units';

/**
 * ContainerLevelPicker — mark the level of the open container by eye.
 *
 * A drawing of the ACTUAL container on the shelf (white 10 L bucket, squat
 * 20 L tub, blue 30 L drum, spirits bottle) with quarter-step zones beside it:
 * Empty · ¼ · ½ · ¾ · Full. Tapping a zone — or the container itself — sets
 * the level; the caller turns the fraction into litres/kg via
 * looseFromFraction and owns the readout. Quarter steps ON PURPOSE: that is
 * what eyes can honestly judge mid-shift, and false precision is worse than
 * none (mock signed off 2026-08-02).
 *
 * The contents are drawn with a clip-path over the container's inner cavity,
 * so one fill rect renders any level on any shape.
 */

export type ContainerShape = 'round' | 'rect' | 'barrel' | 'bottle';

interface ShapeDef {
  viewBox: string;
  width: number;
  height: number;
  /** The inner cavity the contents are clipped to. */
  cavity: string;
  /** y of the cavity's top (Full) and bottom (Empty) in viewBox units. */
  top: number;
  bottom: number;
  /** Drawn under the contents (body, lid). */
  under: React.ReactNode;
  /** Drawn over the contents (handles, labels, caps). */
  over: React.ReactNode;
  /** Contents colour — sauce for buckets, spirit for the bottle. */
  fill: string;
}

const SAUCE = '#A3541F';
const SAUCE_LT = '#C97B45';
const SPIRIT = '#8a5a2b';

const SHAPES: Record<ContainerShape, ShapeDef> = {
  // White 10 L bucket — 263 ⌀ × 262 mm: almost square, ribbed collar, front handle.
  round: {
    viewBox: '0 0 130 138', width: 104, height: 112,
    cavity: 'M14 36 L116 36 L110 126 Q109 132 102 132 L28 132 Q21 132 20 126 Z',
    top: 36, bottom: 132, fill: SAUCE,
    under: (
      <>
        <path d="M12 20 L118 20 L110 126 Q109 132 102 132 L28 132 Q21 132 20 126 Z" fill="#fafaf9" stroke="#a8a29e" strokeWidth="2.5" />
        <path d="M8 18 L122 18 L120 36 L10 36 Z" fill="#ffffff" stroke="#a8a29e" strokeWidth="2.5" />
        <ellipse cx="65" cy="18" rx="55" ry="6.5" fill="none" stroke="#a8a29e" strokeWidth="2.5" />
        <g stroke="#d6d3d1" strokeWidth="1.5" opacity="0.8">
          <line x1="22" y1="22" x2="22" y2="33" /><line x1="38" y1="22" x2="38" y2="33" />
          <line x1="54" y1="22" x2="54" y2="33" /><line x1="76" y1="22" x2="76" y2="33" />
          <line x1="92" y1="22" x2="92" y2="33" /><line x1="108" y1="22" x2="108" y2="33" />
        </g>
      </>
    ),
    over: <path d="M12 32 Q65 92 118 32" fill="none" stroke="#e7e5e4" strokeWidth="5" strokeLinecap="round" />,
  },
  // White 20 L tub — 394×294×247 mm: wider than tall, lid band, red-grip wire handle.
  rect: {
    viewBox: '0 0 176 110', width: 132, height: 82,
    cavity: 'M21 36 L155 36 L150.5 95 Q149.5 100.5 144 100.5 L32 100.5 Q26.5 100.5 25.5 95 Z',
    top: 34, bottom: 103, fill: SAUCE,
    under: (
      <>
        <path d="M18 34 L158 34 L153 96 Q152 103 144 103 L32 103 Q24 103 23 96 Z" fill="#fafaf9" stroke="#a8a29e" strokeWidth="2.5" />
        <path d="M10 12 Q10 6 18 6 L158 6 Q166 6 166 12 L166 28 Q166 34 158 34 L18 34 Q10 34 10 28 Z" fill="#ffffff" stroke="#a8a29e" strokeWidth="2.5" />
        <line x1="16" y1="14" x2="160" y2="14" stroke="#d6d3d1" strokeWidth="2" />
      </>
    ),
    over: (
      <>
        <path d="M14 40 L58 68 L74 68" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        <path d="M162 40 L118 68 L102 68" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        <rect x="72" y="63.5" width="32" height="9" rx="4.5" fill="#dc2626" />
      </>
    ),
  },
  // Blue 30 L HDPE drum — 312 ⌀ × 512 mm: bulged body, open neck, black side handle.
  barrel: {
    viewBox: '0 0 116 170', width: 88, height: 128,
    cavity: 'M26 42 C15.5 63 15.5 128 27 152 Q29 159.5 37 159.5 L79 159.5 Q87 159.5 89 152 C100.5 128 100.5 63 90 42 Z',
    top: 40, bottom: 162, fill: SAUCE,
    under: (
      <>
        <path d="M24 40 C12 62 12 130 24 154 Q26 162 36 162 L80 162 Q90 162 92 154 C104 130 104 62 92 40 Z" fill="#2563eb" stroke="#1e3a8a" strokeWidth="2.5" />
        <path d="M18 22 Q18 14 26 14 L90 14 Q98 14 98 22 L98 30 Q98 38 90 38 L26 38 Q18 38 18 30 Z" fill="#2563eb" stroke="#1e3a8a" strokeWidth="2.5" />
        <ellipse cx="58" cy="15" rx="40" ry="6" fill="#1e3a8a" />
        <ellipse cx="58" cy="15" rx="31" ry="4.5" fill="#0f172a" />
      </>
    ),
    over: <path d="M97 66 Q112 70 111 84 Q110 96 96 96" fill="none" stroke="#111827" strokeWidth="6" strokeLinecap="round" />,
  },
  // Spirits bottle — glass, label, black cap. Level ≈ fraction, neck and all.
  bottle: {
    viewBox: '0 0 64 126', width: 56, height: 110,
    cavity: 'M14 50 C14 40 27 37 27 28 L27 9 L37 9 L37 28 C37 37 50 40 50 52 L50 112 C50 117 47 121.5 41 121.5 L23 121.5 C17 121.5 13.5 117 13.5 112 Z',
    top: 30, bottom: 121, fill: SPIRIT,
    under: (
      <path d="M26 8 L38 8 L38 28 C38 37 51 40 51 52 L51 112 C51 118 47 122 41 122 L23 122 C17 122 13 118 13 112 L13 52 C13 40 26 37 26 28 Z" fill="#f1f0ee" stroke="#a8a29e" strokeWidth="2" />
    ),
    over: (
      <>
        <rect x="18" y="58" width="28" height="34" rx="2" fill="#ffffff" stroke="#d6d3d1" opacity="0.92" />
        <line x1="22" y1="66" x2="42" y2="66" stroke="#a8a29e" strokeWidth="2" />
        <line x1="24" y1="72" x2="40" y2="72" stroke="#d6d3d1" strokeWidth="2" />
        <rect x="24" y="2" width="16" height="9" rx="2" fill="#1c1917" />
      </>
    ),
  },
};

const ZONE_LABEL: Record<number, string> = { 0: 'Empty', 0.25: '¼', 0.5: '½', 0.75: '¾', 1: 'Full' };

interface ContainerLevelPickerProps {
  shape: ContainerShape;
  /** The marked level, or null when nothing has been marked yet. */
  value: LevelFraction | null;
  /** null = un-mark (tapping the selected zone toggles it off). */
  onChange: (fraction: LevelFraction | null) => void;
  /** The Waste Tracker hides Empty — you can't bin nothing. */
  allowEmpty?: boolean;
}

export default function ContainerLevelPicker({ shape, value, onChange, allowEmpty = true }: ContainerLevelPickerProps) {
  const def = SHAPES[shape];
  // useId's colons are legal in HTML ids but flaky inside SVG url(#…) in some
  // engines — strip them.
  const clipId = 'lvl' + useId().replace(/:/g, '');
  const fractions = (allowEmpty ? LEVEL_FRACTIONS : LEVEL_FRACTIONS.filter((f) => f > 0)) as readonly LevelFraction[];
  const shown = value ?? 0;
  const levelY = def.top + (1 - shown) * (def.bottom - def.top);

  /** Tapping the drawing itself sets the level too — nearest quarter to the finger. */
  function tapSvg(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vbH = Number(def.viewBox.split(' ')[3]);
    const y = ((e.clientY - rect.top) / rect.height) * vbH;
    const raw = 1 - (y - def.top) / (def.bottom - def.top);
    let best: LevelFraction = fractions[0];
    for (const f of fractions) if (Math.abs(f - raw) < Math.abs(best - raw)) best = f;
    onChange(best);
  }

  return (
    <div className="flex items-stretch gap-3">
      <div className="flex-1 flex justify-center py-1">
        <svg
          width={def.width} height={def.height} viewBox={def.viewBox}
          onClick={tapSvg} role="img" style={{ cursor: 'pointer' }}
          aria-label={`Container, ${value != null ? ZONE_LABEL[value] : 'level not marked'}`}
        >
          <defs>
            <clipPath id={clipId}><path d={def.cavity} /></clipPath>
          </defs>
          {def.under}
          {value != null && value > 0 && (
            <g clipPath={`url(#${clipId})`}>
              <rect x="0" y={levelY} width="100%" height={def.bottom - levelY + 2} fill={def.fill} opacity="0.88" />
              <rect x="0" y={levelY} width="100%" height="6" fill={shape === 'bottle' ? '#b07c42' : SAUCE_LT} opacity="0.9" />
            </g>
          )}
          {value != null && (
            <>
              {/* Halo + dark stroke: visible on the white bucket in dark mode too. */}
              <line x1="2" y1={levelY} x2="98%" y2={levelY} stroke="#ffffff" strokeWidth="5" strokeDasharray="5 4" opacity="0.85" />
              <line x1="2" y1={levelY} x2="98%" y2={levelY} stroke="#0f172a" strokeWidth="2.5" strokeDasharray="5 4" />
            </>
          )}
          {def.over}
        </svg>
      </div>
      <div className="flex flex-col-reverse justify-end gap-1 py-1">
        {fractions.map((f) => {
          const on = value === f;
          return (
            <button
              key={f} type="button" aria-pressed={on}
              onClick={() => onChange(on ? null : f)}
              className={`min-w-[76px] min-h-[44px] px-3 rounded-xl border text-[var(--fs-sm)] font-bold transition-colors active:scale-[0.97] ${
                on ? 'bg-green-600 border-green-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
              }`}
            >
              {ZONE_LABEL[f]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Tiny read-only variant for Review lines: the container at a marked level. */
export function ContainerLevelGlyph({ shape, fraction, height = 18 }: { shape: ContainerShape; fraction: LevelFraction; height?: number }) {
  const def = SHAPES[shape];
  const clipId = 'lvlg' + useId().replace(/:/g, '');
  const levelY = def.top + (1 - fraction) * (def.bottom - def.top);
  const width = Math.round((def.width / def.height) * height);
  return (
    <svg width={width} height={height} viewBox={def.viewBox} aria-label={`${ZONE_LABEL[fraction]} full`} className="inline-block align-middle">
      <defs><clipPath id={clipId}><path d={def.cavity} /></clipPath></defs>
      {def.under}
      {fraction > 0 && (
        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y={levelY} width="100%" height={def.bottom - levelY + 2} fill={def.fill} />
        </g>
      )}
      {def.over}
    </svg>
  );
}
