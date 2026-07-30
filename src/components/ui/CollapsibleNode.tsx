'use client';

/**
 * One collapsible branch of a tree.
 *
 * Ethan, 2026-07-30, about a location tree deep enough to bury its own rooms:
 * *"is there a way to make the locations that sit inside a location collapsable?
 * so that i have a better overview for isntance for rooms and only when i click
 * on room, i see the shelves, etc that are inside the room"*
 *
 * WHAT THIS OWNS and what it does not. It owns the collapse mechanics only — the
 * chevron, the "N inside" summary, the open/closed state, repainting when the
 * shared store changes. The CALLER renders its own row, because the rows are
 * genuinely different work: the Locations manager row has a drag handle and an
 * edit pencil, the "Where does it live?" sheet row is a tick box. Forcing one row
 * component on both would be the wrong shared thing — the mechanics are what was
 * being copied, not the markup.
 *
 * State lives in lib/tree-expansion (a module-level Map, per scope): it survives
 * client-side navigation and dies on a browser reload, which is exactly what was
 * asked for. See that file for why neither browser storage works.
 */
import React, { useEffect, useState, type ReactNode } from 'react';
import { isExpanded, toggleExpanded, onExpansionChange } from '@/lib/tree-expansion';

export interface CollapsibleNodeProps {
  /** Expansion scope — per screen, so a picker opens independently of a manager. */
  scope: string;
  id: number;
  /** Used in the toggle's accessible name: "Expand Fridge Room". */
  label: string;
  /** The caller's own row markup. Rendered whether open or closed. */
  row: ReactNode;
  /** The children, rendered only when open. Absent/empty = nothing to collapse. */
  children?: ReactNode;
  /** How many records sit below this one, at any depth. Shown when closed. */
  insideCount?: number;
  /**
   * Open regardless of the store — for a branch that contains the current
   * selection, or a search match. A ticked shelf inside a closed room is a
   * selection the user cannot see, which is worse than a long list.
   */
  forceOpen?: boolean;
  /** Wrapper class for the children block (indent, guide line). */
  childrenClassName?: string;
  className?: string;
}

export default function CollapsibleNode({
  scope, id, label, row, children, insideCount, forceOpen = false,
  childrenClassName = 'flex flex-col gap-1.5 mt-1.5 ml-3 pl-3 border-l-2 border-gray-200',
  className,
}: CollapsibleNodeProps) {
  // Repaint when the shared store changes — including from "Expand all", which
  // is triggered by a sibling and would otherwise leave this node stale.
  const [, bump] = useState(0);
  useEffect(() => onExpansionChange(scope, () => bump((n) => n + 1)), [scope]);

  const hasChildren = React.Children.count(children) > 0;
  const open = forceOpen || !hasChildren || isExpanded(scope, id);

  return (
    <div className={className}>
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleExpanded(scope, id)}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            // 32px, not the 16px the chevron looks like — this runs on tablets.
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 active:bg-gray-100"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round"
              className={`transition-transform ${open ? 'rotate-90' : ''}`}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        ) : (
          // A spacer, so names still line up down the column.
          <span className="flex-shrink-0 w-8" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          {row}
          {/* Closing SUMMARISES rather than hides. Without this, a closed row is
              silent and people open every one again to find out what is in it. */}
          {hasChildren && !open && insideCount != null && insideCount > 0 && (
            <button
              type="button"
              onClick={() => toggleExpanded(scope, id)}
              className="mt-0.5 ml-0.5 text-[11px] font-semibold text-gray-400 active:text-gray-600"
            >
              {insideCount} inside {'—'} tap to show
            </button>
          )}
        </div>
      </div>
      {hasChildren && open && <div className={childrenClassName}>{children}</div>}
    </div>
  );
}
