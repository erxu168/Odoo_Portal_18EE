'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Shared drag-to-reorder row (design rule: reorder by dragging, not ↑/↓ arrows).
 *
 * Pair with a @dnd-kit DndContext + SortableContext in the parent. Only the
 * returned `handle` initiates the drag, so the row's own buttons stay clickable;
 * the handle also stops click propagation so tapping it never fires a row-level
 * onClick (e.g. an expand-on-tap card). `touch-none` is scoped to the handle, so
 * the rest of the row still scrolls on touch.
 */

export function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function DragRow({ id, className, children }: {
  id: number | string;
  className?: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  const handle = (
    <button
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      aria-label="Drag to reorder"
      className="w-8 h-8 flex-shrink-0 rounded-lg bg-gray-100 active:bg-gray-200 flex items-center justify-center text-gray-400 cursor-grab touch-none"
    >
      <GripIcon />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children(handle)}
    </div>
  );
}

export default DragRow;
