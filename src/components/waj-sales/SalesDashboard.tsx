'use client';

/**
 * What a Jerk — Sales dashboard shell.
 * Owner + managers only (the /sales page guards the route server-side).
 * Fetches /api/sales?range=… on range change + every 3 min, and renders the
 * active tab. Light-only styling (scoped under .wajs) to match the portal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import {
  TipCtx, OverviewTab, ProductsTab, BusyTab, OrdersTab, KitchenTab,
} from './SalesViz';
import type { Range, SalesPayload } from '@/lib/waj-sales';

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Best-sellers' },
  { id: 'busy', label: 'Busy times' },
  { id: 'orders', label: 'Orders' },
  { id: 'kitchen', label: 'Kitchen' },
] as const;
type TabId = typeof TABS[number]['id'];

export default function SalesDashboard() {
  const [range, setRange] = useState<Range>('week');
  const [tab, setTab] = useState<TabId>('overview');
  const [sort, setSort] = useState<'revenue' | 'qty'>('revenue');
  const [data, setData] = useState<SalesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [, setTick] = useState(0);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const reqRef = useRef(0);

  const fetchData = useCallback(async (silent = false) => {
    const my = ++reqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/sales?range=${range}`);
      const j = await r.json();
      if (my !== reqRef.current) return; // a newer request superseded this one
      if (!r.ok || !j.success) throw new Error(j.error || `Request failed (${r.status})`);
      setData(j.data);
      setFetchedAt(j.computedAt ? Date.parse(j.computedAt) : Date.now());
    } catch (e) {
      if (my === reqRef.current) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (!silent && my === reqRef.current) setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(false); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => fetchData(true), 180000); return () => clearInterval(id); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(id); }, []);

  const show = (text: string, e: React.MouseEvent) => setTip({ text, x: e.clientX, y: e.clientY });
  const hide = () => setTip(null);

  const mins = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 60000) : 0;
  const updated = !fetchedAt ? '' : mins < 1 ? 'updated just now' : mins === 1 ? 'updated 1 min ago' : `updated ${mins} min ago`;

  const refreshAction = (
    <button className="hdr-refresh" onClick={() => fetchData(false)} title="Refresh now" aria-label="Refresh">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
    </button>
  );

  return (
    <TipCtx.Provider value={{ show, hide }}>
      <div className="wajs">
        <AppHeader supertitle="WHAT A JERK" title="Sales" subtitle={data?.sub || 'Loading…'} action={refreshAction} />

        <div className="rangebar" role="group" aria-label="Date range">
          {RANGES.map(r => (
            <button key={r.id} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>

        <nav className="tabbar" role="tablist" aria-label="Sections">
          {TABS.map(t => (
            <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>

        <div className="updated">Auto-updates every 3 min · <b>{updated || 'loading…'}</b></div>

        <main className="content">
          {loading && !data && <div className="empty pad">Loading What a Jerk sales…</div>}
          {error && <div className="errbox">Couldn’t load sales: {error}</div>}
          {data && tab === 'overview' && <OverviewTab d={data} />}
          {data && tab === 'products' && <ProductsTab d={data} sort={sort} setSort={setSort} />}
          {data && tab === 'busy' && <BusyTab d={data} />}
          {data && tab === 'orders' && <OrdersTab d={data} />}
          {data && tab === 'kitchen' && <KitchenTab d={data} />}
        </main>

        <div className="footer-note">Live POS &amp; KDS data for What a Jerk · managers only</div>

        {tip && (
          <div className="tt" style={{ left: Math.min(Math.max(8, tip.x - 70), (typeof window !== 'undefined' ? window.innerWidth : 400) - 148), top: tip.y - 46 }}>{tip.text}</div>
        )}
      </div>

      <style jsx global>{`
        .wajs { --brand:#F5800A; --brand-dark:#E86000; --brand-tint:#FFF4E6;
          --ink:#1F2933; --ink-2:#374151; --muted:#6B7280; --faint:#9CA3AF;
          --surface:#FFFFFF; --surface-2:#F1F3F5; --track:#EDEFF2; --border:#E5E7EB; --bg:#F6F7F9;
          --good:#16A34A; --good-bg:#DCFCE7; --warn:#F59E0B; --bad:#DC2626; --radius:16px;
          --shadow:0 1px 2px rgba(16,24,40,.06);
          min-height:100vh; background:var(--bg); padding-bottom:28px;
          font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:var(--ink); }
        .wajs .hdr-refresh { width:36px;height:36px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff;display:grid;place-items:center;cursor:pointer; }
        .wajs .hdr-refresh:active { transform:scale(.94); }
        .wajs .rangebar { display:flex;gap:5px;padding:12px 14px 6px; }
        .wajs .rangebar button { flex:1;border:1px solid var(--border);background:var(--surface);color:var(--muted);
          font:inherit;font-size:14px;font-weight:700;padding:9px 6px;border-radius:11px;cursor:pointer;transition:.15s; }
        .wajs .rangebar button[aria-pressed="true"] { background:var(--brand);color:#fff;border-color:var(--brand);box-shadow:0 2px 8px rgba(245,128,10,.32); }
        .wajs .tabbar { display:flex;gap:2px;overflow-x:auto;padding:2px 8px 0;background:var(--bg);
          border-bottom:1px solid var(--border);scrollbar-width:none; }
        .wajs .tabbar::-webkit-scrollbar { display:none; }
        .wajs .tab { flex:0 0 auto;border:0;background:transparent;cursor:pointer;font:inherit;font-size:14px;font-weight:600;
          color:var(--muted);padding:11px 12px 9px;border-bottom:2.5px solid transparent;white-space:nowrap; }
        .wajs .tab[aria-selected="true"] { color:var(--brand);border-bottom-color:var(--brand); }
        .wajs .updated { padding:8px 16px 0;font-size:11px;color:var(--faint); }
        .wajs .updated b { color:var(--muted);font-weight:600; }
        .wajs .content { padding:12px 14px;display:flex;flex-direction:column;gap:12px; }
        .wajs .card { background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px; }
        .wajs .card-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px; }
        .wajs .card-title { font-size:15px;font-weight:700;color:var(--ink); }
        .wajs .card-hint { font-size:11px;color:var(--faint);font-weight:500; }
        .wajs .kpi-grid { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
        .wajs .kpi { background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:13px 14px;display:flex;flex-direction:column;gap:3px; }
        .wajs .kpi.wide { grid-column:1/-1; }
        .wajs .kpi.hero { background:linear-gradient(180deg,var(--brand-tint),var(--surface));border-color:#F6C48A; }
        .wajs .kpi-label { font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted); }
        .wajs .kpi-val { font-size:30px;font-weight:800;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.05; }
        .wajs .kpi.small .kpi-val { font-size:21px; }
        .wajs .delta { display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px; }
        .wajs .delta.up { color:var(--good); } .wajs .delta.down { color:var(--bad); }
        .wajs .delta .vs { color:var(--faint);font-weight:500;font-size:11px; }
        .wajs .hbars { display:flex;flex-direction:column;gap:11px; }
        .wajs .hbar { display:grid;grid-template-columns:1fr auto;gap:3px 10px;align-items:baseline; }
        .wajs .hbar .nm { font-size:14px;font-weight:600;color:var(--ink);min-width:0; }
        .wajs .hbar .rk { color:var(--faint);font-weight:700;font-variant-numeric:tabular-nums;margin-right:6px; }
        .wajs .hbar .val { font-size:14px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap; }
        .wajs .hbar .sub { font-size:11px;color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums; }
        .wajs .hbar .track { grid-column:1/-1;height:9px;background:var(--track);border-radius:100px;overflow:hidden; }
        .wajs .hbar .fill { height:100%;background:linear-gradient(90deg,var(--brand-dark),var(--brand));border-radius:100px;min-width:6px; }
        .wajs .vbars { display:flex;align-items:flex-end;gap:3px;height:148px;padding-top:6px; }
        .wajs .vcol { flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end;min-width:0; }
        .wajs .vbar-wrap { width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center; }
        .wajs .vbar { width:74%;max-width:26px;background:color-mix(in srgb,var(--brand) 55%,var(--track));border-radius:4px 4px 0 0;min-height:3px;cursor:default; }
        .wajs .vbar.peak { background:var(--brand); }
        .wajs .vlab { font-size:10px;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap; }
        .wajs .vlab.peak { color:var(--brand);font-weight:800; }
        .wajs .split { display:flex;height:30px;border-radius:9px;overflow:hidden;background:var(--track); }
        .wajs .split > span { display:grid;place-items:center;color:#fff;font-size:11px;font-weight:800;min-width:0; }
        .wajs .split .a { background:var(--brand); } .wajs .split .b { background:#64748B; }
        .wajs .legend { display:flex;gap:16px;margin-top:11px;flex-wrap:wrap; }
        .wajs .legkey { display:flex;align-items:center;gap:7px;font-size:13px;color:var(--ink-2); }
        .wajs .legkey .sw { width:11px;height:11px;border-radius:3px; }
        .wajs .legkey b { font-variant-numeric:tabular-nums; }
        .wajs .legkey .amt { color:var(--muted);font-size:11px;font-weight:600; }
        .wajs .trend { width:100%;height:auto;display:block;overflow:visible; }
        .wajs .trend .area { } .wajs .trend .line { fill:none;stroke:var(--brand);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round; }
        .wajs .trend .grid { stroke:var(--border);stroke-width:1; }
        .wajs .trend .dot { fill:var(--brand);stroke:var(--surface);stroke-width:2.5; }
        .wajs .trend .xlab { fill:var(--faint);font-size:10px;font-weight:600; }
        .wajs .trend .hit { fill:transparent;cursor:default; }
        .wajs .ring-row { display:flex;align-items:center;gap:16px; }
        .wajs .ring { width:108px;height:108px;flex:0 0 auto;position:relative; }
        .wajs .ring svg { transform:rotate(-90deg); }
        .wajs .ring .rt { fill:none;stroke:var(--track);stroke-width:11; }
        .wajs .ring .rv { fill:none;stroke-width:11;stroke-linecap:round; }
        .wajs .ring-center { position:absolute;inset:0;display:grid;place-items:center;text-align:center; }
        .wajs .ring-center .big { font-size:22px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1; }
        .wajs .ring-center .cap { font-size:9.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-top:3px; }
        .wajs .stat-row { display:flex;flex-direction:column;gap:9px;flex:1; }
        .wajs .statline { display:flex;align-items:center;justify-content:space-between;gap:8px; }
        .wajs .statline .k { font-size:13px;color:var(--muted); }
        .wajs .statline .v { font-size:14px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums; }
        .wajs .big-stat { display:flex;align-items:baseline;gap:10px; }
        .wajs .big-stat .n { font-size:32px;font-weight:800;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums; }
        .wajs .big-stat .u { font-size:14px;color:var(--muted);font-weight:600; }
        .wajs .pill { display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:4px 9px;border-radius:100px; }
        .wajs .pill.good { color:var(--good);background:var(--good-bg); } .wajs .pill.warn { color:#92400E;background:#FEF3C7; }
        .wajs .note { display:flex;gap:9px;align-items:flex-start;font-size:13px;color:var(--muted);background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:11px 12px;line-height:1.45; }
        .wajs .note svg { flex:0 0 auto;margin-top:1px;color:var(--brand); }
        .wajs .note b { color:var(--ink-2); }
        .wajs .seg-mini { display:inline-flex;gap:3px;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:3px; }
        .wajs .seg-mini button { border:0;background:transparent;font:inherit;font-size:11px;font-weight:700;color:var(--muted);padding:5px 10px;border-radius:7px;cursor:pointer; }
        .wajs .seg-mini button[aria-pressed="true"] { background:var(--surface);color:var(--brand);box-shadow:var(--shadow); }
        .wajs .empty { color:var(--faint);font-size:13px;text-align:center;padding:18px 0; }
        .wajs .empty.pad { padding:40px 0; }
        .wajs .errbox { background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;border-radius:12px;padding:12px 14px;font-size:13px;font-weight:600; }
        .wajs .footer-note { text-align:center;font-size:11px;color:var(--faint);padding:10px 20px 0; }
        .wajs .tt { position:fixed;z-index:50;pointer-events:none;background:var(--ink);color:#fff;font-size:11px;font-weight:600;
          padding:6px 9px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.28);white-space:nowrap;max-width:220px; }
        @media (prefers-reduced-motion: reduce) { .wajs * { transition:none !important; } }
      `}</style>
    </TipCtx.Provider>
  );
}
