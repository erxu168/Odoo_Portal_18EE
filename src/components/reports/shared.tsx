'use client';

import React, { useState, useEffect } from 'react';
import type { KpiValue } from '@/types/reports';

// ── Formatters ──────────────────────────────────────

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const EUR_INT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('de-DE');

export const fmtEur = (n: number) => EUR.format(n);
export const fmtEurInt = (n: number) => EUR_INT.format(n);
export const fmtNum = (n: number) => NUM.format(n);
export const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;

// ── Location Picker ─────────────────────────────────

export interface Location { id: number; name: string; companyId: number; type: 'counter' | 'sitdown'; }

export const LOCATIONS: Location[] = [
  { id: 7, name: 'Gogi Boss M38', companyId: 2, type: 'counter' },
  { id: 8, name: 'Ssam KD', companyId: 3, type: 'sitdown' },
];

export function LocationPicker({ locationId, onChange }: { locationId: number; onChange: (id: number) => void }) {
  return (
    <div className="flex gap-2 px-5 py-3 bg-white border-b border-gray-200 overflow-x-auto">
      {LOCATIONS.map(loc => (
        <button
          key={loc.id}
          onClick={() => onChange(loc.id)}
          className={`px-3 py-1.5 rounded-lg text-[var(--fs-sm)] font-semibold whitespace-nowrap ${
            locationId === loc.id ? 'bg-[#2563EB] text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {loc.name}
        </button>
      ))}
    </div>
  );
}

// ── Month Picker ────────────────────────────────────

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <input
      type="month"
      value={month}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-[var(--fs-sm)] font-semibold border-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
}

// ── Change Badge ────────────────────────────────────

export function ChangeBadge({ kpi, suffix = 'vs prev' }: { kpi: KpiValue; suffix?: string }) {
  if (kpi.changePercent === undefined) return null;
  const isUp = kpi.trend === 'up';
  const isDown = kpi.trend === 'down';
  const color = isUp ? 'text-green-600' : isDown ? 'text-red-600' : 'text-gray-500';
  const arrow = isUp ? '\u2191' : isDown ? '\u2193' : '\u2192';
  return (
    <span className={`text-[var(--fs-xs)] font-mono font-semibold ${color}`}>
      {arrow} {Math.abs(kpi.changePercent).toFixed(1)}% {suffix}
    </span>
  );
}

// ── KPI Tile ────────────────────────────────────────

interface KpiTileProps {
  label: string;
  kpi: KpiValue;
  size?: 'sm' | 'md' | 'lg';
  changeSuffix?: string;
}

export function KpiTile({ label, kpi, size = 'md', changeSuffix }: KpiTileProps) {
  const valueClass = size === 'lg' ? 'text-[24px]' : size === 'sm' ? 'text-[16px]' : 'text-[20px]';
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
      <div className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-1">{label}</div>
      <div className={`font-bold text-gray-900 ${valueClass} font-mono`}>{kpi.formatted}</div>
      <div className="mt-1 min-h-[18px]">
        <ChangeBadge kpi={kpi} suffix={changeSuffix} />
      </div>
    </div>
  );
}

// ── Section Title ───────────────────────────────────

export function SectionTitle({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="mb-3 mt-5">
      <h2 className="text-[var(--fs-md)] font-bold text-gray-900">{children}</h2>
      {subtitle && <p className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ── Info Tooltip ────────────────────────────────────

export function InfoTooltip({ text, formula, benchmarks }: { text: string; formula?: string; benchmarks?: { label: string; color: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-10 w-64 bg-gray-900 text-white text-[var(--fs-xs)] rounded-lg p-3 shadow-lg">
          <p>{text}</p>
          {formula && <p className="mt-2 font-mono text-yellow-300 text-[11px]">Formula: {formula}</p>}
          {benchmarks && (
            <ul className="mt-2 space-y-0.5">
              {benchmarks.map((b, i) => <li key={i} className="text-[11px]">{b.label}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Loading State ───────────────────────────────────

export function LoadingState({ message = 'Loading\u2026' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-3" />
      <p className="text-[var(--fs-sm)]">{message}</p>
    </div>
  );
}

// ── Error State ─────────────────────────────────────

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="m-5 p-4 bg-red-50 border border-red-200 rounded-xl">
      <p className="text-[var(--fs-sm)] font-bold text-red-900">Could not load report</p>
      <p className="text-[var(--fs-xs)] text-red-700 mt-1 break-words">{error}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-[var(--fs-xs)] font-semibold">
          Try again
        </button>
      )}
    </div>
  );
}

// ── Status Pill ─────────────────────────────────────

export function StatusPill({ status, children }: { status: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const colors = {
    good: 'bg-green-100 text-green-800',
    warn: 'bg-amber-100 text-amber-800',
    bad: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${colors[status]}`}>
      {children}
    </span>
  );
}

// ── useReport hook ──────────────────────────────────

export function useReport<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.success) setData(json.data);
        else setError(json.error || 'Unknown error');
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}
