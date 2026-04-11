'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Generic sortable tile grid with persistent ordering.
 *
 * Usage:
 *   <SortableTileGrid
 *     items={tiles}
 *     getItemId={(t) => t.key}
 *     storageKey="manufacturing_tile_order"
 *     renderItem={(tile, isDragging) => <MyTileButton tile={tile} />}
 *   />
 *
 * storageKey: unique key used to persist the order in the user's preferences
 *             (via PATCH /api/auth/me). Pass the same key to restore order on load.
 * savedOrder: optional initial order loaded from user preferences.
 */

interface SortableTileGridProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  storageKey: string;
  savedOrder?: string[] | null;
  renderItem: (item: T, isDragging: boolean) => React.ReactNode;
  className?: string;
}

function SortableItem<T>({
  item,
  getItemId,
  isDragging,
  renderItem,
}: {
  item: T;
  getItemId: (item: T) => string;
  isDragging: boolean;
  renderItem: (item: T, isDragging: boolean) => React.ReactNode;
}) {
  const id = getItemId(item);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {renderItem(item, isDragging)}
    </div>
  );
}

export default function SortableTileGrid<T>({
  items,
  getItemId,
  storageKey,
  savedOrder,
  renderItem,
  className = 'grid grid-cols-2 gap-3',
}: SortableTileGridProps<T>) {
  const [tileOrder, setTileOrder] = useState<string[] | null>(savedOrder || null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update if savedOrder changes after mount (e.g. async load)
  useEffect(() => {
    if (savedOrder && !tileOrder) {
      setTileOrder(savedOrder);
    }
  }, [savedOrder, tileOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Apply saved order
  const orderedItems = tileOrder
    ? [
        ...tileOrder
          .filter((id) => items.some((item) => getItemId(item) === id))
          .map((id) => items.find((item) => getItemId(item) === id)!),
        ...items.filter((item) => !tileOrder.includes(getItemId(item))),
      ]
    : items;

  const saveTileOrder = useCallback(
    (order: string[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        fetch('/api/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferences: { [storageKey]: order } }),
        }).catch(() => {});
      }, 500);
    },
    [storageKey],
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedItems.findIndex((item) => getItemId(item) === active.id);
    const newIndex = orderedItems.findIndex((item) => getItemId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(orderedItems, oldIndex, newIndex);
    const newOrder = reordered.map(getItemId);
    setTileOrder(newOrder);
    saveTileOrder(newOrder);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveDragId(e.active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
      <SortableContext items={orderedItems.map(getItemId)} strategy={rectSortingStrategy}>
        <div className={className}>
          {orderedItems.map((item) => (
            <SortableItem
              key={getItemId(item)}
              item={item}
              getItemId={getItemId}
              isDragging={activeDragId === getItemId(item)}
              renderItem={renderItem}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
