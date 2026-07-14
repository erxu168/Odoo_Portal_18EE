'use client';

import React from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface GuideItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  category_name: string;
  par_level?: number;
  product_code?: string;
}

function DragHandleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="6" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

function Row({ item, onRemove }: { item: GuideItem; onRemove: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5 py-2.5 border-b border-gray-100 last:border-0 bg-white">
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        style={{ touchAction: 'none' }}
        className="w-8 h-11 flex items-center justify-center text-gray-300 flex-shrink-0 cursor-grab active:cursor-grabbing"
      >
        <DragHandleIcon />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
        <div className="text-[11px] text-gray-500 font-mono">
          &euro;{item.price.toFixed(2)}/{item.product_uom}
          {item.product_code ? ` · #${item.product_code}` : ''}
          {item.par_level ? ` · par ${item.par_level}` : ''}
        </div>
      </div>
      <button
        onClick={() => onRemove(item.id)}
        className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 active:bg-red-100 flex-shrink-0"
      >
        Remove
      </button>
    </div>
  );
}

/**
 * Drag-to-sort guide items into walk-in order (Choco-style). Items reorder
 * WITHIN their category; onReorder receives the full ordered item-id list so
 * the caller can persist sort_order. A short touch delay keeps the page scrollable.
 */
export default function SortableGuideItems({
  items,
  onReorder,
  onRemove,
}: {
  items: GuideItem[];
  onReorder: (itemIds: number[]) => void;
  onRemove: (id: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );
  const cats = Array.from(new Set(items.map((i) => i.category_name || 'Other')));
  const byCat = (c: string) => items.filter((i) => (i.category_name || 'Other') === c);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeItem = items.find((i) => i.id === Number(active.id));
    const overItem = items.find((i) => i.id === Number(over.id));
    if (!activeItem || !overItem) return;
    const cat = activeItem.category_name || 'Other';
    if ((overItem.category_name || 'Other') !== cat) return; // only reorder within a category
    const catIds = byCat(cat).map((i) => i.id);
    const from = catIds.indexOf(Number(active.id));
    const to = catIds.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(catIds, from, to);
    const full: number[] = [];
    for (const c of cats) full.push(...(c === cat ? reordered : byCat(c).map((i) => i.id)));
    onReorder(full);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {cats.map((cat) => (
        <div key={cat}>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2 pb-1">{cat}</div>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3 mb-2">
            <SortableContext items={byCat(cat).map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {byCat(cat).map((item) => <Row key={item.id} item={item} onRemove={onRemove} />)}
            </SortableContext>
          </div>
        </div>
      ))}
    </DndContext>
  );
}
