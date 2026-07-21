import React from 'react';
import { getBadgeStyle } from '@/lib/design-system';

/**
 * Status chip (badge) — one structural style, color carries the meaning.
 * `tone` is a design-system state key (e.g. 'overdue', 'done', 'draft').
 * Supports an optional leading icon for the "icon + colour + text" status rule
 * (status must never be colour-only).
 *
 * Promoted to ui/ in wave 0 from shift-handover/common.tsx.
 */
export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Chip({ tone = 'neutral', icon, children, className = '', ...rest }: ChipProps) {
  // Match the original inline span exactly when there is no icon (no visual
  // change for existing callers); switch to inline-flex only to align an icon.
  const layout = icon ? 'inline-flex items-center gap-1' : 'inline-block';
  return (
    <span
      className={`${layout} text-[var(--fs-xs)] px-2 py-0.5 rounded-md font-bold whitespace-nowrap ${className}`}
      style={getBadgeStyle(tone)}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

export default Chip;
