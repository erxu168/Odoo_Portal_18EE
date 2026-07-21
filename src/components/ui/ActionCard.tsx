'use client';

import React from 'react';
import SortableTileGrid from './SortableTileGrid';

/**
 * Action card + grid — the portal design standard's module launcher tile.
 *
 * A flat WHITE card (no pastel background, no shadow) with an emoji in a 44px
 * soft-gray square, a bold title, an optional gray subtitle, and an optional
 * corner count badge. Green badge by default; red only when it needs attention.
 * `active:scale-[0.97]` press feedback, 44px+ target.
 *
 * Promoted to ui/ in wave 0 from the inline tiles in shift-handover/Dashboard.tsx.
 * The emoji is decorative (aria-hidden); the button's accessible name comes from
 * the title, subtitle and the badge's aria-label.
 */
export type ActionBadgeTone = 'count' | 'danger';

export interface ActionCardBadge {
  value: string | number;
  tone?: ActionBadgeTone;
  ariaLabel?: string;
}

export interface ActionCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  emoji: string;
  label: string;
  subtitle?: React.ReactNode;
  badge?: ActionCardBadge;
}

export function ActionCard({ emoji, label, subtitle, badge, className = '', disabled, ...rest }: ActionCardProps) {
  const showBadge = badge != null && badge.value !== '' && badge.value !== 0;
  return (
    <button
      type="button"
      disabled={disabled}
      className={`relative w-full h-full bg-white rounded-2xl border border-gray-200 p-4 text-left transition-transform min-h-[104px] flex flex-col ${
        disabled ? 'opacity-50' : 'active:scale-[0.97]'
      } ${className}`}
      {...rest}
    >
      <div className="w-11 h-11 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-2xl mb-2" aria-hidden="true">
        {emoji}
      </div>
      <div className="text-[var(--fs-base)] font-bold text-gray-900 leading-tight">{label}</div>
      {subtitle && <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{subtitle}</div>}
      {showBadge && (
        <span
          className={`absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full text-white text-[var(--fs-xs)] font-bold flex items-center justify-center ${
            badge!.tone === 'danger' ? 'bg-red-500' : 'bg-green-600'
          }`}
          aria-label={badge!.ariaLabel}
        >
          {badge!.value}
        </span>
      )}
    </button>
  );
}

export interface ActionGridProps<T> {
  items: T[];
  getItemId: (item: T) => string;
  renderItem: (item: T, isDragging: boolean) => React.ReactNode;
  /** When present, tiles become drag-to-reorder via SortableTileGrid. */
  sortable?: {
    storageKey: string;
    savedOrder?: string[] | null;
  };
  className?: string;
}

export function ActionGrid<T>({ items, getItemId, renderItem, sortable, className = 'grid grid-cols-2 gap-3' }: ActionGridProps<T>) {
  if (sortable) {
    return (
      <SortableTileGrid
        items={items}
        getItemId={getItemId}
        storageKey={sortable.storageKey}
        savedOrder={sortable.savedOrder}
        renderItem={renderItem}
        className={className}
      />
    );
  }
  return (
    <div className={className}>
      {items.map((item) => (
        <React.Fragment key={getItemId(item)}>{renderItem(item, false)}</React.Fragment>
      ))}
    </div>
  );
}

export default ActionCard;
