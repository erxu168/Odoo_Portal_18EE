'use client';

import React, { useState } from 'react';
import { ds, getBadgeStyle } from '@/lib/design-system';

// ── Fetch helpers ────────────────────────────────────────────────────────────
export async function apiGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || 'Something went wrong.');
  return data as T;
}

export async function apiSend<T = any>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error || 'Something went wrong.') as Error & { validation?: unknown; status?: number };
    err.validation = data?.validation;
    err.status = r.status;
    throw err;
  }
  return data as T;
}

// ── Badge chip ───────────────────────────────────────────────────────────────
export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="text-[var(--fs-xs)] px-2 py-0.5 rounded-md font-bold whitespace-nowrap" style={getBadgeStyle(tone)}>
      {children}
    </span>
  );
}

// ── Bottom sheet ─────────────────────────────────────────────────────────────
export function Sheet({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[var(--fs-lg)] font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 active:text-gray-600 w-9 h-9 flex items-center justify-center" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-gray-100 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

// ── Form field ───────────────────────────────────────────────────────────────
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className={ds.fieldRow}>
      <label className={ds.label}>{label}</label>
      {children}
      {hint && <p className="text-[var(--fs-xs)] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ── Big-target option grid (minimal typing, glove-friendly) ──────────────────
export function OptionGrid<T extends string | number>({ value, options, onChange, cols = 2 }: {
  value: T | null | undefined;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  cols?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-[48px] px-3 py-2.5 rounded-xl text-[var(--fs-sm)] font-semibold border transition-colors active:scale-[0.98] ${
              active ? 'bg-green-600 text-white border-green-600 shadow-sm'
                : o.disabled ? 'bg-gray-50 text-gray-300 border-gray-100 line-through'
                : 'bg-white text-gray-700 border-gray-200 active:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Primary / secondary buttons ──────────────────────────────────────────────
export function PrimaryButton({ onClick, disabled, busy, children }: {
  onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled || busy} className={`${ds.btnPrimary} disabled:opacity-50 flex items-center justify-center gap-2`}>
      {busy && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  );
}

// ── Toast-ish inline error ───────────────────────────────────────────────────
export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 text-[var(--fs-sm)] px-3 py-2.5 mb-3">{children}</div>;
}

// ── Location helpers ─────────────────────────────────────────────────────────
export interface FlatLocation { id: number; parent_id: number | null; name: string }

/** Build "Parent › Child" option labels from a flat location list. */
export function buildLocationOptions(flat: FlatLocation[]): Array<{ value: number; label: string }> {
  const byId = new Map(flat.map((l) => [l.id, l]));
  function path(id: number): string {
    const parts: string[] = [];
    let cur: number | null = id; const seen = new Set<number>();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      parts.unshift(node.name);
      cur = node.parent_id;
    }
    return parts.join(' › ');
  }
  return flat.map((l) => ({ value: l.id, label: path(l.id) })).sort((a, b) => a.label.localeCompare(b.label));
}

// ── Styled native select (touch-friendly) ───────────────────────────────────
export function Select({ value, onChange, options, placeholder }: {
  value: number | string | null;
  onChange: (v: string) => void;
  options: Array<{ value: number | string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 h-12 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-600 appearance-none"
      style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236B7280\' stroke-width=\'2\'><path d=\'M6 9l6 6 6-6\'/></svg>")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); return undefined; }
    finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}
