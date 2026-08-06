'use client';

/**
 * The mark-up toolbar for an annotated photo — tool, colour, line weight,
 * erase / undo / clear — plus the small state machine behind it.
 *
 * Guides and task subtasks both let a manager draw on a photo. This is that
 * toolbar, once: a second copy would drift from the first the day either one
 * changed, and the behaviour here is the part that took real bugs to get right
 * (selection surviving an undo, restyling what is selected rather than only the
 * next mark, saying so when the cap is hit instead of swallowing the drawing).
 *
 * Split in two on purpose:
 *   useDrawingTools()  — the state; the caller feeds it straight to PinnableImage
 *   <DrawingToolbar />  — the visible controls
 * so a screen can position the controls wherever it likes without re-deriving
 * how they behave.
 */
import { useEffect, useState } from 'react';
import {
  DRAWING_COLORS,
  DRAWING_COLOR_NAMES,
  DRAWING_WIDTH_LEVELS,
  DEFAULT_DRAWING_WIDTH,
  clampDrawingWidth,
  drawingWidthPx,
  MAX_DRAWINGS,
  type GuideDrawing,
  type GuideDrawingType,
} from '@/lib/guide-drawings';
import { useConfirm } from './useConfirm';

export interface DrawingTools {
  /** Active tool. null means "place note-pins", which only exists where pins do. */
  tool: GuideDrawingType | null;
  setTool: (t: GuideDrawingType | null) => void;
  color: string;
  /** Line weight LEVEL 1..5, never pixels. */
  width: number;
  /** Index of the mark the author tapped, or null. */
  selected: number | null;
  setSelected: (i: number | null) => void;
  /** True when the author drew past the cap, so the screen can say so. */
  capHit: boolean;
  shapes: GuideDrawing[];
  /** Set the style of the next mark — and of the selected one, if there is one. */
  applyStyle: (patch: Partial<Pick<GuideDrawing, 'color' | 'width'>>) => void;
  /** A finished mark, straight from PinnableImage's onDrawAdd. */
  add: (shape: GuideDrawing) => void;
  /** A mark was moved or stretched. */
  update: (index: number, shape: GuideDrawing) => void;
  eraseSelected: () => void;
  undo: () => void;
  clear: () => void;
  /** True when there are no marks at all (undo / clear have nothing to do). */
  empty: boolean;
}

interface Options {
  shapes: GuideDrawing[];
  onChange: (shapes: GuideDrawing[]) => void;
  /** When the photo also carries numbered note-pins, "Dots" is a tool and is the
   *  default. Without pins there is no Dots, so a tool must always be active —
   *  otherwise dragging on the photo would silently do nothing. */
  allowPins?: boolean;
}

export function useDrawingTools({ shapes, onChange, allowPins = false }: Options): DrawingTools {
  const [tool, setTool] = useState<GuideDrawingType | null>(allowPins ? null : 'arrow');
  const [color, setColor] = useState<string>(DRAWING_COLORS[0]);
  const [width, setWidth] = useState<number>(DEFAULT_DRAWING_WIDTH);
  const [capHit, setCapHit] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  // Keep the selection valid: undo / clear / erase can remove the selected mark,
  // and a stale index would highlight the wrong shape.
  useEffect(() => {
    if (selected != null && selected >= shapes.length) setSelected(null);
  }, [selected, shapes.length]);

  // Selection only means something while a drawing tool is active — with pins
  // enabled, switching back to Dots must drop it.
  useEffect(() => {
    if (!tool && allowPins) setSelected(null);
  }, [tool, allowPins]);

  // Selecting a mark loads its style into the pickers, so the toolbar always
  // describes what is selected instead of quietly disagreeing with it.
  useEffect(() => {
    if (selected == null) return;
    const s = shapes[selected];
    if (!s) return;
    setColor(s.color);
    setWidth(clampDrawingWidth(s.width));
  }, [selected, shapes]);

  function applyStyle(patch: Partial<Pick<GuideDrawing, 'color' | 'width'>>) {
    if (patch.color !== undefined) setColor(patch.color);
    if (patch.width !== undefined) setWidth(patch.width);
    if (selected != null && shapes[selected]) {
      onChange(shapes.map((s, i) => (i === selected ? { ...s, ...patch } : s)));
    }
  }

  return {
    tool, setTool, color, width, selected, setSelected, capHit, shapes, applyStyle,
    empty: shapes.length === 0,
    add(shape) {
      // Never swallow the mark the author just drew: at the cap, say so.
      if (shapes.length >= MAX_DRAWINGS) { setCapHit(true); return; }
      setCapHit(false);
      onChange([...shapes, shape]);
      // Select it straight away, so it can be nudged or stretched without
      // hunting for it first.
      setSelected(shapes.length);
    },
    update(index, shape) {
      onChange(shapes.map((s, i) => (i === index ? shape : s)));
    },
    eraseSelected() {
      if (selected == null) return;
      setCapHit(false);
      onChange(shapes.filter((_, i) => i !== selected));
      setSelected(null);
    },
    undo() {
      setCapHit(false);
      setSelected(null);
      onChange(shapes.slice(0, -1));
    },
    clear() {
      setCapHit(false);
      setSelected(null);
      onChange([]);
    },
  };
}

export function ToolButton({ label, active = false, disabled, onClick }: {
  label: string; active?: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`min-h-[38px] px-2.5 rounded-lg text-[var(--fs-xs)] font-semibold border disabled:opacity-40 ${
        active
          ? 'bg-green-600 border-green-600 text-white'
          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

export default function DrawingToolbar({ tools, disabled = false, allowPins = false }: {
  tools: DrawingTools;
  disabled?: boolean;
  allowPins?: boolean;
}) {
  const { confirm, confirmElement } = useConfirm();

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg">
      {confirmElement}
      {allowPins && (
        <ToolButton label="● Dots" active={tools.tool === null} disabled={disabled} onClick={() => tools.setTool(null)} />
      )}
      <ToolButton label="↗ Arrow" active={tools.tool === 'arrow'} disabled={disabled} onClick={() => tools.setTool('arrow')} />
      <ToolButton label="◯ Circle" active={tools.tool === 'circle'} disabled={disabled} onClick={() => tools.setTool('circle')} />
      <ToolButton label="▭ Box" active={tools.tool === 'box'} disabled={disabled} onClick={() => tools.setTool('box')} />
      <ToolButton label="✎ Pen" active={tools.tool === 'pen'} disabled={disabled} onClick={() => tools.setTool('pen')} />
      <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
      {DRAWING_COLORS.map(c => (
        <button
          key={c}
          type="button"
          onClick={() => tools.applyStyle({ color: c })}
          disabled={disabled}
          aria-label={`Draw in ${DRAWING_COLOR_NAMES[c]}`}
          aria-pressed={tools.color === c}
          title={DRAWING_COLOR_NAMES[c]}
          style={{ background: c }}
          className={`w-7 h-7 rounded-full border-2 border-white disabled:opacity-50 ${
            tools.color === c ? 'ring-2 ring-gray-800 scale-110' : 'ring-1 ring-gray-300'
          }`}
        />
      ))}
      <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
      {/* Five line weights, drawn at their real thickness so the picker shows
          what you get. Thin lines disappear on a busy kitchen photo. */}
      {DRAWING_WIDTH_LEVELS.map(lvl => (
        <button
          key={lvl}
          type="button"
          onClick={() => tools.applyStyle({ width: lvl })}
          disabled={disabled}
          aria-label={`Line thickness ${lvl} of ${DRAWING_WIDTH_LEVELS.length}`}
          aria-pressed={tools.width === lvl}
          title={`Thickness ${lvl}`}
          className={`w-7 h-7 flex items-center justify-center rounded-md bg-white disabled:opacity-50 ${
            tools.width === lvl ? 'ring-2 ring-gray-800' : 'ring-1 ring-gray-300'
          }`}
        >
          <span
            aria-hidden="true"
            className="block w-4 rounded-full bg-gray-800"
            style={{ height: `${drawingWidthPx(lvl)}px` }}
          />
        </button>
      ))}
      <span className="w-px self-stretch bg-gray-200 mx-0.5" aria-hidden="true" />
      <ToolButton
        label="⌫ Erase"
        disabled={disabled || tools.selected == null}
        onClick={() => tools.eraseSelected()}
      />
      <ToolButton
        label="↶ Undo"
        disabled={disabled || tools.empty}
        onClick={() => tools.undo()}
      />
      <ToolButton
        label="Clear"
        disabled={disabled || tools.empty}
        onClick={async () => {
          if (!await confirm({
            title: 'Remove all drawings?',
            message: allowPins
              ? 'Every mark on this photo goes. The numbered note-pins stay.'
              : 'Every mark on this photo goes. The photo itself stays.',
            confirmLabel: 'Remove all',
            variant: 'danger',
          })) return;
          tools.clear();
        }}
      />
      {tools.capHit && (
        <span className="w-full text-[var(--fs-xs)] font-semibold text-red-600 mt-0.5">
          That is the most marks one photo can hold ({MAX_DRAWINGS}). Erase one first.
        </span>
      )}
      {tools.tool && !tools.capHit && (
        <span className="w-full text-[var(--fs-xs)] text-gray-500 mt-0.5">
          {tools.selected != null
            ? 'Drag the mark to move it, or its white handles to stretch it. Colour and thickness restyle it; Erase deletes it.'
            : 'Drag on the photo to draw. Tap a mark to move, stretch, restyle or erase it.'}
          {allowPins && <> Pick <strong>Dots</strong> to place numbered notes again.</>}
        </span>
      )}
    </div>
  );
}
