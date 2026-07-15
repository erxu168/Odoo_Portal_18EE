'use client';

/**
 * What a Jerk — Sales dashboard: presentational chart primitives + tab bodies.
 * Pure, data-in / markup-out. All hover tooltips go through TipCtx (provided by
 * SalesDashboard). Styling lives in SalesDashboard's scoped <style> under .wajs.
 */

import React, { useContext } from 'react';
import type { SalesPayload } from '@/lib/waj-sales';

// ── formatters ──────────────────────────────────────────
const eur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('de-DE');
const pctS = (n: number) => (n >= 0 ? '+' : '') + n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
function mmss(sec: number) { const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return `${m}m ${s < 10 ? '0' : ''}${s}s`; }

export interface Delta { pct: number; label: string; hasBase: boolean }

// ── tooltip context ─────────────────────────────────────
export const TipCtx = React.createContext<{ show: (t: string, e: React.MouseEvent) => void; hide: () => void }>({ show: () => {}, hide: () => {} });

// ── primitives ──────────────────────────────────────────
export function KpiTile({ label, value, deltas, hero }:
  { label: string; value: string; deltas: Delta[]; hero?: boolean }) {
  return (
    <div className={`kpi ${hero ? 'hero wide' : 'small'}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-val">{value}</span>
      {deltas.filter(d => d.label).map((d, i) => {
        if (!d.hasBase) return <span key={i} className="delta flat">– <span className="vs">{d.label} (no data)</span></span>;
        const up = d.pct >= 0;
        return <span key={i} className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {pctS(Math.abs(d.pct))} <span className="vs">{d.label}</span></span>;
      })}
    </div>
  );
}

export function TrendChart({ points }: { points: [string, number, number][] }) {
  const tip = useContext(TipCtx);
  const W = 340, H = 150, padX = 10, padTop = 14, plotBot = 26;
  const n = points.length;
  if (!n) return <div className="empty">No sales in this period.</div>;
  const vals = points.map(p => p[1]);
  const max = Math.max(...vals), min = Math.min(...vals);
  const lo = Math.min(min * 0.85, min - (max - min) * 0.15);
  const span = (max - lo) || 1;
  const plotW = W - padX * 2, plotH = H - padTop - plotBot;
  const X = (i: number) => padX + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
  const Y = (v: number) => padTop + plotH * (1 - (v - lo) / span);
  let line = '';
  points.forEach((p, i) => { line += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[1]).toFixed(1) + ' '; });
  const area = line + `L${X(n - 1).toFixed(1)} ${padTop + plotH} L${X(0).toFixed(1)} ${padTop + plotH} Z`;
  const step = n > 9 ? Math.ceil(n / 6) : 1;
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales trend">
      <defs><linearGradient id="wajs-area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
        <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.02" />
      </linearGradient></defs>
      {[0, 1, 2].map(g => { const gy = padTop + plotH * g / 2; return <line key={g} className="grid" x1={padX} y1={gy} x2={W - padX} y2={gy} />; })}
      <path className="area" d={area} fill="url(#wajs-area)" />
      <path className="line" d={line} />
      <circle className="dot" cx={X(n - 1)} cy={Y(points[n - 1][1])} r={4.5} />
      {points.map((p, i) => {
        const hw = plotW / n;
        const t = `${p[0]} · ${eur0.format(p[1])} · ${num.format(p[2])} orders`;
        return <rect key={i} className="hit" x={X(i) - hw / 2} y={padTop} width={hw} height={plotH} onMouseMove={e => tip.show(t, e)} onMouseLeave={tip.hide} />;
      })}
      {points.map((p, i) => (i % step === 0 || i === n - 1)
        ? <text key={'l' + i} className="xlab" x={X(i)} y={H - 8} textAnchor="middle">{p[0]}</text> : null)}
    </svg>
  );
}

export function VBars({ rows, money, unit = '' }: { rows: [string, number][]; money?: boolean; unit?: string }) {
  const tip = useContext(TipCtx);
  if (!rows.length) return <div className="empty">No data.</div>;
  const max = Math.max(...rows.map(r => r[1]), 1);
  const peak = rows.reduce((bi, r, i, a) => (r[1] > a[bi][1] ? i : bi), 0);
  return (
    <div className="vbars">
      {rows.map((r, i) => {
        const h = Math.max(4, Math.round(r[1] / max * 100));
        const isPeak = i === peak && r[1] > 0;
        const v = money ? eur0.format(r[1]) : num.format(r[1]) + unit;
        return (
          <div className="vcol" key={i}>
            <div className="vbar-wrap"><div className={`vbar ${isPeak ? 'peak' : ''}`} style={{ height: h + '%' }} onMouseMove={e => tip.show(`${r[0]} · ${v}`, e)} onMouseLeave={tip.hide} /></div>
            <div className={`vlab ${isPeak ? 'peak' : ''}`}>{r[0]}</div>
          </div>
        );
      })}
    </div>
  );
}

export function HBars({ rows, mode }: { rows: [string, number, number][]; mode: 'revenue' | 'qty' }) {
  const tip = useContext(TipCtx);
  if (!rows.length) return <div className="empty">No products sold in this period.</div>;
  const sorted = [...rows].sort((a, b) => (mode === 'qty' ? b[1] - a[1] : b[2] - a[2])).slice(0, 12);
  const max = Math.max(...sorted.map(r => (mode === 'qty' ? r[1] : r[2])), 1);
  return (
    <div className="hbars">
      {sorted.map((r, i) => {
        const primary = mode === 'qty' ? num.format(r[1]) + ' sold' : eur0.format(r[2]);
        const secondary = mode === 'qty' ? eur0.format(r[2]) : num.format(r[1]) + ' sold';
        const w = Math.round((mode === 'qty' ? r[1] : r[2]) / max * 100);
        return (
          <div className="hbar" key={i} onMouseMove={e => tip.show(`${r[0]} · ${num.format(r[1])} sold · ${eur0.format(r[2])}`, e)} onMouseLeave={tip.hide}>
            <div className="nm"><span className="rk">{i + 1}</span>{r[0]}</div>
            <div className="val">{primary}<div className="sub">{secondary}</div></div>
            <div className="track"><div className="fill" style={{ width: w + '%' }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function SplitBar({ aLabel, aPct, aAmt, bLabel, bPct, bAmt }:
  { aLabel: string; aPct: number; aAmt: string; bLabel: string; bPct: number; bAmt: string }) {
  const tip = useContext(TipCtx);
  return (
    <>
      <div className="split" role="img" aria-label={`${aLabel} ${aPct}%, ${bLabel} ${bPct}%`}>
        <span className="a" style={{ width: aPct + '%' }} onMouseMove={e => tip.show(`${aLabel} · ${aPct}% · ${aAmt}`, e)} onMouseLeave={tip.hide}>{aPct >= 8 ? aPct + '%' : ''}</span>
        <span className="b" style={{ width: bPct + '%' }} onMouseMove={e => tip.show(`${bLabel} · ${bPct}% · ${bAmt}`, e)} onMouseLeave={tip.hide}>{bPct >= 8 ? bPct + '%' : ''}</span>
      </div>
      <div className="legend">
        <span className="legkey"><span className="sw" style={{ background: 'var(--brand)' }} />{aLabel} <b>{aPct}%</b> <span className="amt">{aAmt}</span></span>
        <span className="legkey"><span className="sw" style={{ background: '#64748B' }} />{bLabel} <b>{bPct}%</b> <span className="amt">{bAmt}</span></span>
      </div>
    </>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="note">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
      <div>{children}</div>
    </div>
  );
}

// ── tab bodies ──────────────────────────────────────────
export function OverviewTab({ d }: { d: SalesPayload }) {
  const sales = d.salesTotal, orders = d.ordersTotal, avg = orders ? sales / orders : 0;
  const prevAvg = d.prevOrders ? d.prevSales / d.prevOrders : 0;
  const yoyAvg = d.yoyOrders ? d.yoySales / d.yoyOrders : 0;
  // Baseline presence is decided by the order count (a real but zero-revenue
  // baseline is not "no data"), while the % uses the revenue baseline.
  // Needs orders AND a positive baseline: a % change from a non-positive base is undefined.
  const mk = (cur: number, base: number, baseOrders: number, label: string): Delta => ({ pct: base > 0 ? ((cur - base) / base) * 100 : 0, label, hasBase: baseOrders > 0 && base > 0 });
  const best = d.dow && d.dow.length ? d.dow.reduce((b, r) => (r[1] > b[1] ? r : b)) : null;
  return (
    <>
      <div className="kpi-grid">
        <KpiTile label="Total sales" value={eur0.format(sales)} hero deltas={[mk(sales, d.prevSales, d.prevOrders, d.prevLabel), mk(sales, d.yoySales, d.yoyOrders, d.yoyLabel)]} />
        <KpiTile label="Orders" value={num.format(orders)} deltas={[mk(orders, d.prevOrders, d.prevOrders, d.prevLabel), mk(orders, d.yoyOrders, d.yoyOrders, d.yoyLabel)]} />
        <KpiTile label="Avg / order" value={eur2.format(avg)} deltas={[mk(avg, prevAvg, d.prevOrders, d.prevLabel), mk(avg, yoyAvg, d.yoyOrders, d.yoyLabel)]} />
      </div>
      <div className="card">
        <div className="card-head"><span className="card-title">Sales trend</span><span className="card-hint">{d.trendUnit}</span></div>
        <TrendChart points={d.trend} />
      </div>
      {best ? <InfoNote>Strongest day was <b>{best[0]}</b> ({eur0.format(best[1])}).</InfoNote> : null}
    </>
  );
}

export function ProductsTab({ d, sort, setSort }: { d: SalesPayload; sort: 'revenue' | 'qty'; setSort: (s: 'revenue' | 'qty') => void }) {
  const fd = d.foodRev + d.drinkRev;
  // Refunds can push a subtotal negative; only show the split when both are
  // non-negative and there is net revenue, and clamp the percentage.
  const showSplit = d.foodRev >= 0 && d.drinkRev >= 0 && fd > 0;
  const foodPct = showSplit ? Math.max(0, Math.min(100, Math.round((d.foodRev / fd) * 100))) : 0;
  return (
    <>
      <div className="card">
        <div className="card-head"><span className="card-title">Food vs drink</span><span className="card-hint">by amount</span></div>
        {showSplit
          ? <SplitBar aLabel="Food" aPct={foodPct} aAmt={eur0.format(d.foodRev)} bLabel="Drink" bPct={100 - foodPct} bAmt={eur0.format(d.drinkRev)} />
          : <div className="empty">No sales in this period.</div>}
      </div>
      <div className="card">
        <div className="card-head"><span className="card-title">By category</span><span className="card-hint">revenue</span></div>
        <HBars rows={d.categories} mode="revenue" />
      </div>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Best-sellers</span>
          <span className="seg-mini" role="group" aria-label="Sort by">
            <button aria-pressed={sort === 'revenue'} onClick={() => setSort('revenue')}>€ Revenue</button>
            <button aria-pressed={sort === 'qty'} onClick={() => setSort('qty')}>Qty sold</button>
          </span>
        </div>
        <HBars rows={d.products} mode={sort} />
      </div>
    </>
  );
}

export function BusyTab({ d }: { d: SalesPayload }) {
  return (
    <>
      <div className="card">
        <div className="card-head"><span className="card-title">Busy hours</span><span className="card-hint">{d.hoursHint}</span></div>
        <VBars rows={d.hours} />
      </div>
      {d.dow
        ? <div className="card"><div className="card-head"><span className="card-title">By day of week</span><span className="card-hint">avg sales / day</span></div><VBars rows={d.dow} money /></div>
        : <InfoNote>Day-of-week needs more than one day. Switch to <b>This week</b> or <b>This month</b> to compare Mon–Sun.</InfoNote>}
    </>
  );
}

export function OrdersTab({ d }: { d: SalesPayload }) {
  const cashAmt = eur0.format(d.cashAmt);
  const cardAmt = eur0.format(d.cardAmt);
  const dineIn = d.dineInOrders;
  const takeaway = d.takeawayOrders;
  return (
    <>
      <div className="card"><div className="card-head"><span className="card-title">Payment mix</span><span className="card-hint">by amount</span></div>
        <SplitBar aLabel="Card" aPct={100 - d.cashPct} aAmt={cardAmt} bLabel="Cash" bPct={d.cashPct} bAmt={cashAmt} />
      </div>
      <div className="card"><div className="card-head"><span className="card-title">Dine-in vs take-away</span><span className="card-hint">by orders</span></div>
        <SplitBar aLabel="Take-away" aPct={100 - d.dineInPct} aAmt={`${num.format(takeaway)} orders`} bLabel="Dine-in" bPct={d.dineInPct} bAmt={`${num.format(dineIn)} orders`} />
      </div>
      <div className="card"><div className="card-head"><span className="card-title">Items per order</span><span className="card-hint">avg {d.avgItems.toLocaleString('de-DE')} items</span></div>
        <VBars rows={d.items} unit="%" />
      </div>
    </>
  );
}

export function KitchenTab({ d }: { d: SalesPayload }) {
  if (!d.kitchenHasData) {
    return <InfoNote>No kitchen timings recorded for this period yet. Prep times come from the KDS — they start accumulating from now on, so day-of-week trends fill in over the coming days.</InfoNote>;
  }
  const under = d.prepUnder;
  const ringColor = under >= 75 ? 'var(--good)' : under >= 60 ? 'var(--warn)' : 'var(--bad)';
  const avgCls = d.prepAvg <= 540 ? 'good' : 'warn';
  return (
    <>
      <div className="card">
        <div className="card-head"><span className="card-title">Prep speed</span><span className="card-hint">order placed → done</span></div>
        <div className="big-stat"><span className="n">{mmss(d.prepAvg)}</span><span className="u">average</span><span style={{ flex: 1 }} /><span className={`pill ${avgCls}`}>target ≤ 10m</span></div>
        <div className="ring-row" style={{ marginTop: 12 }}>
          <div className="ring"><svg width="108" height="108" viewBox="0 0 108 108"><circle className="rt" cx="54" cy="54" r="45" /><circle className="rv" cx="54" cy="54" r="45" style={{ stroke: ringColor, strokeDasharray: 2 * Math.PI * 45, strokeDashoffset: 2 * Math.PI * 45 * (1 - under / 100) }} /></svg>
            <div className="ring-center"><div className="big">{under}%</div><div className="cap">under 10 min</div></div></div>
          <div className="stat-row">
            <div className="statline"><span className="k">Fastest</span><span className="v">{mmss(d.prepFast)}</span></div>
            <div className="statline"><span className="k">Slowest</span><span className="v">{mmss(d.prepSlow)}</span></div>
            <div className="statline"><span className="k">Recorded</span><span className="v">{d.coverage}% of orders</span></div>
          </div>
        </div>
      </div>
      {d.prepDow
        ? <><div className="card"><div className="card-head"><span className="card-title">Prep time by day</span><span className="card-hint">avg minutes</span></div><VBars rows={d.prepDow} unit="m" /></div>
          <InfoNote>The kitchen tends to slow on the busiest days — worth watching against staffing.</InfoNote></>
        : null}
    </>
  );
}
