'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';
import RecordLink from '@/components/ui/RecordLink';

interface ConsumptionReportProps {
  onBack: () => void;
}

function fmt(n: number) { return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString(); }

/**
 * Usage report — portal-native, no Odoo.
 *   used = start count + deliveries received − end count
 * You pick a start count and an end count of the SAME list; the server
 * (/api/inventory/usage) computes per-product usage and flags any product that
 * wasn't counted at both ends.
 */
export default function ConsumptionReport({ onBack }: ConsumptionReportProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load the count sessions to choose from (already company-scoped server-side).
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/inventory/sessions').then(r => r.json());
        const list = (d.sessions || []).slice()
          .sort((a: any, b: any) => String(b.scheduled_date).localeCompare(String(a.scheduled_date)));
        setSessions(list);
      } catch { setError('Could not load counts.'); }
      finally { setLoadingSessions(false); }
    })();
  }, []);

  const opening = useMemo(() => sessions.find(s => s.id === openingId) || null, [sessions, openingId]);
  // End-count options: the SAME list as the start, dated on/after it — so the
  // pairing the server accepts is the only thing offered.
  const closingOptions = useMemo(() => {
    if (!opening) return [];
    return sessions.filter(s => s.template_id === opening.template_id && s.id !== opening.id
      && String(s.scheduled_date) >= String(opening.scheduled_date));
  }, [sessions, opening]);

  const load = useCallback(async () => {
    if (!openingId || !closingId) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const d = await fetch(`/api/inventory/usage?opening_session=${openingId}&closing_session=${closingId}`).then(r => r.json());
      if (d.error) { setError(d.error); setRows([]); return; }
      const rws = d.rows || [];
      setRows(rws);
      const ids = Array.from(new Set<number>(rws.map((r: any) => r.product_id)));
      if (ids.length > 0) {
        try {
          const pd = await fetch(`/api/inventory/products?ids=${ids.join(',')}&limit=1000`).then(r => r.json());
          const map: Record<number, string> = {};
          (pd.products || []).forEach((p: any) => { map[p.id] = p.name; });
          setNames(map);
        } catch { /* names are best-effort */ }
      }
    } catch { setError('Network error. Try again.'); }
    finally { setLoading(false); }
  }, [openingId, closingId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r: any) => (names[r.product_id] || `#${r.product_id}`).toLowerCase().includes(q));
  }, [rows, names, search]);

  const sel = 'h-10 px-2.5 border border-gray-300 rounded-lg text-[var(--fs-sm)] text-gray-900 bg-white outline-none focus:border-green-500 min-w-0 flex-1';
  const label = (s: any) => `${s.template_name || 'List'} · ${s.scheduled_date}${s.status && s.status !== 'approved' ? ` (${s.status})` : ''}`;
  const bothPicked = !!openingId && !!closingId;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Usage</h1>
      </div>

      <div className="px-4 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
        <span>Used = start count + deliveries received {'−'} end count. Pick a start and end count of the same list.</span>
      </div>

      {loadingSessions ? <Spinner /> : (
        <div className="px-4 py-2 flex items-center gap-2">
          <select className={sel} value={openingId ?? ''}
            onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setOpeningId(v); setClosingId(null); }}
            aria-label="Start count">
            <option value="">Start count{'…'}</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select>
          <span className="text-[var(--fs-sm)] text-gray-400 flex-shrink-0">{'→'}</span>
          <select className={sel} value={closingId ?? ''}
            onChange={(e) => setClosingId(e.target.value ? Number(e.target.value) : null)}
            aria-label="End count" disabled={!openingId}>
            <option value="">End count{'…'}</option>
            {closingOptions.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select>
        </div>
      )}

      <SearchBar value={search} onChange={setSearch} placeholder="Search ingredient..." />

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)] font-semibold">{error}</div>
      ) : !bothPicked ? (
        <EmptyState title="Pick two counts" body="Choose a start count and an end count of the same list to see what was used." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing to show" body="No products in these counts, or nothing matches your search." />
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-24">
          <div className="text-[var(--fs-xs)] text-gray-400 py-2">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</div>
          {filtered.map((r: any) => (
            <div key={r.product_id} className="py-3 border-b border-gray-100">
              <div className="flex items-center justify-between gap-3">
                {/* Drill-down: "where did this number come from?" — open the product */}
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className="min-w-0 text-[var(--fs-base)] font-semibold text-gray-900 truncate">{names[r.product_id] || `#${r.product_id}`}</span>
                  <RecordLink type="product" id={r.product_id} label={names[r.product_id]} className="w-6 h-6" />
                </div>
                <div className="text-right flex-shrink-0">
                  {r.complete ? (
                    <>
                      <span className="text-[var(--fs-lg)] font-mono font-bold text-gray-900">{fmt(r.consumption)}</span>
                      <span className="text-[var(--fs-xs)] text-gray-400 ml-1">used</span>
                    </>
                  ) : (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      not counted at {r.missing}
                    </span>
                  )}
                </div>
              </div>
              {r.complete && (
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5 font-mono">
                  start {fmt(r.opening_qty)} + received {fmt(r.received_qty)} {'−'} end {fmt(r.closing_qty)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
