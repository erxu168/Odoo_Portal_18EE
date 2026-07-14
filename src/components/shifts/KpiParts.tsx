'use client';

import React from 'react';

/**
 * Shared presentational primitives for the Planning KPI dashboards
 * (ManagerKpiStack + StaffKpiStack). Pure display — no data fetching.
 * Follows DESIGN_GUIDE.md: green brand, semantic amber/red, var(--fs-*) tokens.
 */

// --- Card wrapper (optionally tappable) --------------------------------------

export function KpiCard({
  children,
  onClick,
  className = '',
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const base = `rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`;
  if (onClick) {
    return (
      <button
        onClick={onClick}
        aria-label={ariaLabel}
        className={`${base} text-left w-full active:scale-[0.99] transition-transform`}
      >
        {children}
      </button>
    );
  }
  return <div className={base}>{children}</div>;
}

// --- Section overline --------------------------------------------------------

export function KpiSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-widest uppercase pb-2 pl-0.5">
      {children}
    </h2>
  );
}

// --- Circular progress ring (SVG) --------------------------------------------

export type RingTone = 'green' | 'amber' | 'red' | 'gray';

const RING_STROKE: Record<RingTone, string> = {
  green: '#16a34a',
  amber: '#f59e0b',
  red: '#ef4444',
  gray: '#d1d5db',
};

/**
 * A ring filled to `pct` (0–1) in `tone`, with free-form centered content.
 * size/stroke are in px; the track is a light grey full circle.
 */
export function Ring({
  pct,
  tone,
  size = 96,
  stroke = 9,
  children,
}: {
  pct: number;
  tone: RingTone;
  size?: number;
  stroke?: number;
  children: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const dash = c * clamped;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f2f4" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={RING_STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
        {children}
      </div>
    </div>
  );
}

/** Format a decimal hours value as "12.5h" (drops a trailing .0). */
export function hoursLabel(h: number): string {
  const r = Math.round(h * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}h`;
}

/** Ring tone from usage vs a limit: green under 85%, amber 85–100%, red over. */
export function usageTone(hours: number, limit: number | null): RingTone {
  if (!limit || limit <= 0) return 'gray';
  const p = hours / limit;
  if (p > 1.0 + 1e-9) return 'red';
  if (p >= 0.85) return 'amber';
  return 'green';
}

// --- Coverage heat-strip (7 Berlin days, Mon→Sun) ----------------------------

export interface CoverageDay {
  date: string;
  shifts: number;
  open: number;
  overCap: number;
}

const DOW_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function coverageTone(d: CoverageDay): { cell: string; text: string; label: string } {
  if (d.shifts === 0) return { cell: 'bg-gray-100', text: 'text-gray-400', label: '·' };
  if (d.overCap > 0) return { cell: 'bg-red-100', text: 'text-red-700', label: String(d.overCap) };
  if (d.open > 0) return { cell: 'bg-amber-100', text: 'text-amber-800', label: String(d.open) };
  return { cell: 'bg-green-100', text: 'text-green-700', label: '✓' };
}

export function CoverageStrip({ days }: { days: CoverageDay[] }) {
  return (
    <div className="flex gap-1.5">
      {days.slice(0, 7).map((d, i) => {
        const t = coverageTone(d);
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div
              className={`w-full aspect-square rounded-lg ${t.cell} flex items-center justify-center`}
            >
              <span className={`text-[var(--fs-sm)] font-bold tabular-nums ${t.text}`}>
                {t.label}
              </span>
            </div>
            <span className="text-[var(--fs-xs)] font-semibold text-gray-400">{DOW_LETTERS[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Flag / risk row ---------------------------------------------------------

export type FlagTone = 'red' | 'amber' | 'green';

const FLAG_DOT: Record<FlagTone, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
};

export function FlagRow({
  tone,
  primary,
  secondary,
}: {
  tone: FlagTone;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${FLAG_DOT[tone]}`} />
      <span className="text-[var(--fs-sm)] font-semibold text-gray-800 min-w-0 truncate">
        {primary}
      </span>
      {secondary && (
        <span className="text-[var(--fs-sm)] text-gray-500 ml-auto flex-shrink-0 tabular-nums">
          {secondary}
        </span>
      )}
    </div>
  );
}

// --- Mini stat (inline number + label) ---------------------------------------

export function MiniStat({
  value,
  label,
  tone = 'default',
}: {
  value: string | number;
  label: string;
  tone?: 'default' | 'green' | 'amber' | 'red';
}) {
  const color =
    tone === 'green'
      ? 'text-green-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-600'
          : 'text-gray-900';
  return (
    <div className="text-center min-w-0">
      <div className={`text-[var(--fs-xxl)] font-extrabold tabular-nums ${color}`}>{value}</div>
      <div className="text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mt-0.5 truncate">
        {label}
      </div>
    </div>
  );
}
