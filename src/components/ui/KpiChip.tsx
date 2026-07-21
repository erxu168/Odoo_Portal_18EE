import React from 'react';

/**
 * KPI stat chip + row — part of the portal design standard.
 *
 * A white bordered chip with one big number and a small uppercase label. The
 * number turns red ONLY when the stat is an actionable problem (overdue,
 * blocked), so red always means "look here". Up to four per row.
 *
 * Promoted to ui/ in wave 0 from the private Kpi in shift-handover/Dashboard.tsx.
 */
export interface KpiChipProps {
  value: React.ReactNode;
  label: string;
  tone?: 'default' | 'danger';
}

export function KpiChip({ value, label, tone = 'default' }: KpiChipProps) {
  const danger = tone === 'danger';
  return (
    <div className="rounded-xl bg-white border border-gray-200 py-2.5 text-center">
      <div className={`text-[var(--fs-xl)] font-bold tabular-nums ${danger ? 'text-red-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
    </div>
  );
}

export interface KpiRowProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

export function KpiRow({ children, columns = 4, className = '' }: KpiRowProps) {
  return <div className={`grid ${COLS[columns]} gap-2 ${className}`}>{children}</div>;
}
