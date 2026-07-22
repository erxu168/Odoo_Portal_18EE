'use client';

import React, { useState } from 'react';

// ── Promoted shared primitives (wave 0) ─────────────────────────────────────
// These now live in src/components/ui/ as the portal design standard. They are
// re-exported here so the shift-handover screens keep importing them from
// './common' unchanged. New modules should import from '@/components/ui/*'.
export { BottomSheet as Sheet } from '@/components/ui/BottomSheet';
export { Chip } from '@/components/ui/Chip';
export { Field } from '@/components/ui/Field';
export { Select } from '@/components/ui/Select';
export { OptionGrid } from '@/components/ui/OptionGrid';
export { PrimaryButton } from '@/components/ui/PrimaryButton';

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

// ── Date/time helpers (shift log) ────────────────────────────────────────────
/** "17:25" from an ISO timestamp (tablet-local, which is Berlin for the kitchens). */
export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
/** "Tue 22 Jul" from a 'YYYY-MM-DD' operational date (parsed at noon UTC, no TZ rollover). */
export function fmtDayShort(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
/** Add whole days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD'. */
export function shiftDayAdd(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
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
