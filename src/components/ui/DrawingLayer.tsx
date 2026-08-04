'use client';

import { useRef, useState } from 'react';
import {
  DEFAULT_DRAWING_WIDTH,
  clampDrawingWidth,
  distanceToShape,
  drawingWidthPx,
  hitTestDrawing,
  moveShapeHandle,
  shapeBounds,
  shapeHandles,
  translateShape,
  type GuideDrawing,
  type GuideDrawingType,
} from '@/lib/guide-drawings';

/**
 * Vector overlay for the marks an author draws over a photo (arrow / circle /
 * box / freehand pen) to emphasise something.
 *
 * Renders in a 0–100 viewBox with `preserveAspectRatio="none"`, so shapes stored
 * as fractions 0..1 land on the same spot at any size — the same coordinate
 * contract as note-pins. Stroke widths are given in viewBox units and kept
 * visually constant with `vector-effect: non-scaling-stroke`.
 *
 * The marks are an OVERLAY, never burned into the photo: the original bytes are
 * untouched, and every mark stays editable.
 *
 * mode='view'  — render only (staff). Pointer-transparent so pins stay tappable.
 * mode='draw'  — the author's canvas:
 *     drag on empty space   → draw a new mark with the active tool
 *     tap a mark            → select it
 *     drag a selected mark  → move it
 *     drag its handle       → stretch that end / corner
 *     tap empty space       → deselect
 *   Manipulation requires selecting FIRST, so a drag that happens to start over
 *   an existing mark still draws a new one rather than silently moving it.
 */
export interface DrawingLayerProps {
  shapes: GuideDrawing[];
  mode: 'view' | 'draw';
  /** draw: the active drawing tool. */
  tool?: GuideDrawingType;
  /** draw: stroke colour (#RRGGBB) for new marks. */
  color?: string;
  /** draw: line weight LEVEL (1..5) for new marks. */
  width?: number;
  /** draw: index of the selected mark, or null. */
  selectedIndex?: number | null;
  /** draw: selection changed (null = nothing selected). */
  onSelect?: (index: number | null) => void;
  /** draw: a new mark was finished. */
  onAdd?: (shape: GuideDrawing) => void;
  /** draw: an existing mark was moved or stretched. */
  onUpdate?: (index: number, shape: GuideDrawing) => void;
  /** draw: freeze while a save is in flight. */
  disabled?: boolean;
}

/** Below this movement (in fractions) a gesture is a tap, not a drag. */
const MIN_DRAG = 0.02;
/** How close a tap must be to count as hitting a mark or a handle. */
const HIT_TOL = 0.04;
const HANDLE_TOL = 0.05;
/** Cap points per stroke so one long scribble can't bloat the payload. */
const MAX_POINTS = 400;

type Gesture =
  | { kind: 'pending'; pointerId: number; start: [number, number] }
  | { kind: 'draw'; pointerId: number; start: [number, number] }
  | { kind: 'move'; pointerId: number; start: [number, number]; orig: GuideDrawing; index: number }
  | { kind: 'handle'; pointerId: number; handle: number; orig: GuideDrawing; index: number };

export default function DrawingLayer({
  shapes, mode, tool = 'arrow', color = '#DC2626', width = DEFAULT_DRAWING_WIDTH,
  selectedIndex = null, onSelect, onAdd, onUpdate, disabled = false,
}: DrawingLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** The shape being drawn, moved or stretched right now (render-only). */
  const [live, setLive] = useState<GuideDrawing | null>(null);
  /** Mirrors the live gesture so render can tell which shape it replaces. */
  const [liveIndex, setLiveIndex] = useState(-1);
  const gesture = useRef<Gesture | null>(null);

  const active = mode === 'draw' && !disabled;
  const selected = selectedIndex != null ? shapes[selectedIndex] : undefined;

  function fractions(e: React.PointerEvent): [number, number] | null {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  }

  function endGesture() {
    gesture.current = null;
    setLive(null);
    setLiveIndex(-1);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!active || gesture.current) return;
    const p = fractions(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    // A selected mark is directly manipulable: handles first (they sit on the
    // outline, so they must win over the body), then the body.
    if (selected && selectedIndex != null) {
      const handles = shapeHandles(selected);
      for (let h = 0; h < handles.length; h++) {
        if (Math.hypot(p[0] - handles[h][0], p[1] - handles[h][1]) <= HANDLE_TOL) {
          gesture.current = { kind: 'handle', pointerId: e.pointerId, handle: h, orig: selected, index: selectedIndex };
          setLive(selected);
          setLiveIndex(selectedIndex);
          return;
        }
      }
      if (distanceToShape(selected, p[0], p[1]) <= HIT_TOL) {
        gesture.current = { kind: 'move', pointerId: e.pointerId, start: p, orig: selected, index: selectedIndex };
        setLive(selected);
        setLiveIndex(selectedIndex);
        return;
      }
    }
    // Otherwise we don't yet know if this is a tap (select) or a drag (draw).
    gesture.current = { kind: 'pending', pointerId: e.pointerId, start: p };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const p = fractions(e);
    if (!p) return;

    if (g.kind === 'pending') {
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) < MIN_DRAG / 2) return;
      gesture.current = { kind: 'draw', pointerId: g.pointerId, start: g.start };
      setLive({ type: tool, color, width: clampDrawingWidth(width), points: [g.start, p] });
      setLiveIndex(-1);
      return;
    }
    if (g.kind === 'draw') {
      setLive(prev => {
        if (!prev) return prev;
        if (prev.type === 'pen') {
          if (prev.points.length >= MAX_POINTS) return prev;
          return { ...prev, points: [...prev.points, p] };
        }
        return { ...prev, points: [g.start, p] };
      });
      return;
    }
    if (g.kind === 'move') {
      setLive(translateShape(g.orig, p[0] - g.start[0], p[1] - g.start[1]));
      return;
    }
    setLive(moveShapeHandle(g.orig, g.handle, p[0], p[1]));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const finished = live;
    endGesture();
    if (disabled) return;

    if (g.kind === 'pending') {
      // A tap: select whatever is under it, or clear the selection.
      const p = fractions(e) || g.start;
      const hit = hitTestDrawing(shapes, p[0], p[1], HIT_TOL);
      onSelect?.(hit >= 0 ? hit : null);
      return;
    }
    if (!finished) return;

    if (g.kind === 'draw') {
      // Ignore a stray tap: measure real travel, not point count — a jittery tap
      // emits several points while going nowhere and would leave an invisible mark.
      const b = shapeBounds(finished);
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < MIN_DRAG) return;
      onAdd?.(finished);
      return;
    }
    // A stretch that collapsed the shape to nothing would leave an invisible
    // mark — keep the original instead.
    if (g.kind === 'handle') {
      const b = shapeBounds(finished);
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < MIN_DRAG) return;
    }
    onUpdate?.(g.index, finished);
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (gesture.current && e.pointerId === gesture.current.pointerId) endGesture();
  }

  // While a gesture is live, render it in place of the shape it belongs to.
  const rendered = shapes.map((s, i) => (i === liveIndex && live ? live : s));
  const all = live && liveIndex === -1 ? [...rendered, live] : rendered;
  const shownSelected = selectedIndex != null ? rendered[selectedIndex] : undefined;

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 ${active ? 'cursor-crosshair' : 'pointer-events-none'}`}
      // touch-action:none ONLY while the author is drawing, so the page still
      // scrolls normally otherwise (iOS pitfall #4).
      style={active ? { touchAction: 'none' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 w-full h-full">
        {all.map((s, i) => (
          <Shape key={i} shape={s} />
        ))}
        {active && shownSelected && <SelectionOutline shape={shownSelected} />}
      </svg>

      {/* Handles are HTML, not SVG: the viewBox is stretched by
          preserveAspectRatio="none", which would squash an SVG circle out of
          shape, and this way each handle gets a proper 44px touch target. */}
      {active && shownSelected && shapeHandles(shownSelected).map(([hx, hy], i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ left: `${hx * 100}%`, top: `${hy * 100}%` }}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-gray-900 shadow cursor-grab"
        >
          <span className="absolute -inset-3.5" />
        </span>
      ))}
    </div>
  );
}

/** Dashed box around the selected mark, so it is obvious what is being edited. */
function SelectionOutline({ shape }: { shape: GuideDrawing }) {
  const b = shapeBounds(shape);
  const pad = 1.5;
  const x = Math.max(0, b.x0 * 100 - pad);
  const y = Math.max(0, b.y0 * 100 - pad);
  return (
    <rect
      x={x}
      y={y}
      width={Math.min(100 - x, (b.x1 - b.x0) * 100 + pad * 2)}
      height={Math.min(100 - y, (b.y1 - b.y0) * 100 + pad * 2)}
      fill="none"
      stroke="#111827"
      strokeWidth={1}
      strokeDasharray="3 2"
      vectorEffect="non-scaling-stroke"
      style={{ filter: 'drop-shadow(0 0 1.5px rgba(255,255,255,0.9))' }}
    />
  );
}

function Shape({ shape }: { shape: GuideDrawing }) {
  const { type, color, points } = shape;
  const level = clampDrawingWidth(shape.width);
  const px = drawingWidthPx(level);
  const common = {
    stroke: color,
    fill: 'none',
    strokeWidth: px,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    // Keep the line the same visual weight regardless of the photo's size or
    // aspect ratio (the viewBox is stretched by preserveAspectRatio="none").
    // With non-scaling-stroke the width is read in screen pixels, so the level
    // maps straight to px.
    vectorEffect: 'non-scaling-stroke' as const,
    // A white mark on a pale photo would vanish — a soft dark halo keeps every
    // colour readable on any background. It grows with the stroke so a bold
    // mark doesn't outrun its own outline.
    style: { filter: `drop-shadow(0 0 ${Math.max(1.5, px * 0.4).toFixed(1)}px rgba(0,0,0,0.55))` },
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
    // Head grows with the line: a fixed head on a bold stroke reads as a blob
    // barely wider than the shaft. viewBox units, so it scales with the photo.
    const HEAD = 3.4 + 1.1 * level;
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
