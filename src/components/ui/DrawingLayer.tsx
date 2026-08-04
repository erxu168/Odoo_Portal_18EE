'use client';

import { useRef, useState } from 'react';
import type { GuideDrawing, GuideDrawingType } from '@/lib/task-guide';

/**
 * Vector overlay for the marks an author draws over a photo (arrow / circle /
 * box / freehand pen) to emphasise something.
 *
 * Renders in a 0–100 viewBox with `preserveAspectRatio="none"`, so shapes stored
 * as fractions 0..1 land on the same spot at any size — the same coordinate
 * contract as note-pins. Stroke widths are therefore given in viewBox units and
 * kept visually constant with `vector-effect: non-scaling-stroke`.
 *
 * The marks are an OVERLAY, never burned into the photo: the original bytes are
 * untouched, and every mark stays editable and undoable.
 *
 * mode='view'  — render only (staff). Pointer-transparent so pins stay tappable.
 * mode='draw'  — capture pointer gestures to add shapes (editor, tool selected).
 */
export interface DrawingLayerProps {
  shapes: GuideDrawing[];
  mode: 'view' | 'draw';
  /** draw: which tool the author picked ('erase' removes one mark on tap). */
  tool?: GuideDrawingType | 'erase';
  /** draw: stroke colour (#RRGGBB). */
  color?: string;
  /** draw: called with the finished shape when a gesture ends. */
  onAdd?: (shape: GuideDrawing) => void;
  /** draw: erase tool — the author tapped at these fractions. */
  onEraseAt?: (x: number, y: number) => void;
  /** draw: freeze while a save is in flight. */
  disabled?: boolean;
}

/** Below this movement (in fractions) a gesture is a stray tap, not a shape. */
const MIN_DRAG = 0.02;
/** Cap points per stroke so one long scribble can't bloat the payload. */
const MAX_POINTS = 400;

export default function DrawingLayer({
  shapes, mode, tool = 'arrow', color = '#DC2626', onAdd, onEraseAt, disabled = false,
}: DrawingLayerProps) {
  const erasing = tool === 'erase';
  const svgRef = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<GuideDrawing | null>(null);
  const gesture = useRef<{ pointerId: number; start: [number, number] } | null>(null);

  function fractions(e: React.PointerEvent): [number, number] | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (mode !== 'draw' || disabled || gesture.current) return;
    const p = fractions(e);
    if (!p) return;
    e.preventDefault();
    // Erase is a tap, not a drag: remove the mark under the finger.
    if (erasing) { onEraseAt?.(p[0], p[1]); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointerId: e.pointerId, start: p };
    setLive({ type: tool as GuideDrawingType, color, points: [p, p] });
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const p = fractions(e);
    if (!p) return;
    setLive(prev => {
      if (!prev) return prev;
      if (prev.type === 'pen') {
        if (prev.points.length >= MAX_POINTS) return prev;
        return { ...prev, points: [...prev.points, p] };
      }
      return { ...prev, points: [g.start, p] };
    });
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    const finished = live;
    setLive(null);
    if (!finished || disabled) return;
    // Measure real travel, not point count: a jittery tap can emit several
    // points while going nowhere, which would leave an invisible mark the author
    // can see no way to remove.
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const [px, py] of finished.points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (Math.hypot(maxX - minX, maxY - minY) < MIN_DRAG) return;
    onAdd?.(finished);
  }

  function onPointerCancel(e: React.PointerEvent<SVGSVGElement>) {
    if (gesture.current && e.pointerId === gesture.current.pointerId) {
      gesture.current = null;
      setLive(null);
    }
  }

  const all = live ? [...shapes, live] : shapes;
  const drawing = mode === 'draw' && !disabled;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full ${
        drawing ? (erasing ? 'cursor-pointer' : 'cursor-crosshair') : 'pointer-events-none'
      }`}
      // touch-action:none ONLY while a tool is active, so the page still scrolls
      // normally when the author is not drawing (iOS pitfall #4).
      style={drawing ? { touchAction: 'none' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {all.map((s, i) => (
        <Shape key={i} shape={s} />
      ))}
    </svg>
  );
}

function Shape({ shape }: { shape: GuideDrawing }) {
  const { type, color, points } = shape;
  const common = {
    stroke: color,
    fill: 'none',
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    // Keep the line the same visual weight regardless of the photo's size or
    // aspect ratio (the viewBox is stretched by preserveAspectRatio="none").
    vectorEffect: 'non-scaling-stroke' as const,
    // A white mark on a pale photo would vanish — a soft dark halo keeps every
    // colour readable on any background.
    style: { filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.55))' },
  };
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];

  if (type === 'arrow') {
    // The head is drawn explicitly rather than with an SVG <marker>: a marker
    // sized in strokeWidth units collapses to a speck once the stroke is
    // non-scaling, and preserveAspectRatio="none" would shear it on a non-square
    // photo. Building it from the line's own end point keeps it visible and
    // correctly aimed at any size.
    const ang = Math.atan2((ey - sy) * 100, (ex - sx) * 100);
    const HEAD = 4.5;          // viewBox units
    const SPREAD = Math.PI / 7;
    const x2 = ex * 100, y2 = ey * 100;
    const wing = (dir: number) => [
      x2 - HEAD * Math.cos(ang + dir),
      y2 - HEAD * Math.sin(ang + dir),
    ];
    const [wx1, wy1] = wing(SPREAD);
    const [wx2, wy2] = wing(-SPREAD);
    return (
      <g>
        <line x1={sx * 100} y1={sy * 100} x2={x2} y2={y2} {...common} />
        <polygon points={`${x2},${y2} ${wx1},${wy1} ${wx2},${wy2}`} {...common} fill={color} />
      </g>
    );
  }
  if (type === 'circle') {
    return (
      <ellipse
        cx={((sx + ex) / 2) * 100} cy={((sy + ey) / 2) * 100}
        rx={(Math.abs(ex - sx) / 2) * 100} ry={(Math.abs(ey - sy) / 2) * 100}
        {...common}
      />
    );
  }
  if (type === 'box') {
    return (
      <rect
        x={Math.min(sx, ex) * 100} y={Math.min(sy, ey) * 100}
        width={Math.abs(ex - sx) * 100} height={Math.abs(ey - sy) * 100}
        {...common}
      />
    );
  }
  return (
    <polyline
      points={points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')}
      {...common}
    />
  );
}
