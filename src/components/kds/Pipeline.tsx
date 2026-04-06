'use client';

import { useState } from 'react';
import { useKds } from '@/lib/kds/state';
import { effectiveWait, timerTier } from '@/lib/kds/priority';
import { SOURCES } from '@/types/kds';
import type { KdsOrder } from '@/types/kds';
import Timer from './Timer';
import SourceBadge from './SourceBadge';

type PipeView = 'orders' | 'summary';

export default function Pipeline() {
  const { orders, roundState, firedOrderIds, settings } = useKds();
  const [view, setView] = useState<PipeView>('orders');
  const boost = settings.takeawayBoost;

  const prep = orders
    .filter(o => o.status === 'prep')
    .sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  return (
    <div className="kds-pipeline-view">
      <div className="kds-pipe-toggle">
        <button className={`kds-pipe-toggle-btn ${view === 'orders' ? 'active' : ''}`} onClick={() => setView('orders')}>Orders</button>
        <button className={`kds-pipe-toggle-btn ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>Summary</button>
      </div>

      {prep.length === 0 ? (
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u{1F389}'}</div>
          <div>No orders in pipeline</div>
        </div>
      ) : view === 'orders' ? (
        <div className="kds-pipe-scroll">
          {prep.map(o => {
            const isTa = o.type === 'Takeaway';
            const inRound = firedOrderIds.includes(o.id) && roundState === 'active';
            const isQueued = roundState === 'active' && !firedOrderIds.includes(o.id);
            const done = o.items.filter(i => i.done).length;
            const total = o.items.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const tier = timerTier(o.waitMin, o.type, settings);

            return (
              <div key={o.id} className={`kds-pipe-order ${isTa ? 'is-ta' : ''}`}>
                <div className="kds-pipe-order-head">
                  <div className="kds-pipe-order-left">
                    <span className="kds-pipe-order-table">{o.table}</span>
                    {isTa ? <span className="kds-s-takeaway">TAKEAWAY</span> : <span className="kds-pipe-order-type">Dine-in</span>}
                    <Timer minutes={o.waitMin} tier={tier} size="md" />
                    {inRound && <span className="kds-pipe-order-status in-round">IN ROUND</span>}
                    {isQueued && <span className="kds-pipe-order-status queued">NEXT ROUND</span>}
                  </div>
                  <div className="kds-pipe-order-progress">
                    <span className="kds-pipe-order-pct">{done}/{total}</span>
                    <div className="kds-pipe-mini-bar"><div className="kds-pipe-mini-bar-fill" style={{ width: `${pct}%` }} /></div>
                  </div>
                </div>
                <div className="kds-pipe-order-items">
                  {o.items.map(item => (
                    <div key={item.id} className={`kds-pipe-order-item ${item.done ? 'poi-done' : ''}`}>
                      <span className="kds-poi-qty">{item.qty}x</span>
                      <span className="kds-poi-name">{item.name}</span>
                      {SOURCES[item.name] && <SourceBadge dishName={item.name} />}
                      {item.note && <span className="kds-s-note">{item.note}</span>}
                      {item.done && <span style={{ color: 'var(--green)', fontSize: '12px', fontWeight: 700 }}>{'\u2713'}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <PipelineSummary orders={prep} />
      )}
    </div>
  );
}

function PipelineSummary({ orders }: { orders: KdsOrder[] }) {
  const dishMap: Record<string, { name: string; totalQty: number; doneQty: number; tables: string[] }> = {};

  for (const o of orders) {
    for (const item of o.items) {
      if (!dishMap[item.name]) dishMap[item.name] = { name: item.name, totalQty: 0, doneQty: 0, tables: [] };
      dishMap[item.name].totalQty += item.qty;
      if (item.done) dishMap[item.name].doneQty += item.qty;
      if (!dishMap[item.name].tables.includes(o.table)) dishMap[item.name].tables.push(o.table);
    }
  }

  const dishes = Object.values(dishMap).sort((a, b) => (b.totalQty - b.doneQty) - (a.totalQty - a.doneQty));
  const totalItems = dishes.reduce((s, d) => s + d.totalQty, 0);
  const totalDone = dishes.reduce((s, d) => s + d.doneQty, 0);

  return (
    <div className="kds-pipe-scroll">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '0 4px' }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--muted)' }}>
          {orders.length} orders &middot; {totalItems} total items
        </span>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--green)' }}>{totalDone} served</span>
      </div>
      <div className="kds-pipe-summary-card">
        <div className="kds-pipe-summary-head">Dish totals</div>
        {dishes.map(d => {
          const remaining = d.totalQty - d.doneQty;
          return (
            <div key={d.name} className="kds-pipe-sum-row">
              <div className="kds-pipe-sum-qty" style={{ color: remaining > 0 ? 'var(--text)' : 'var(--green)' }}>{d.totalQty}</div>
              <div style={{ flex: 1 }}>
                <div className="kds-pipe-sum-name">
                  {d.name} <SourceBadge dishName={d.name} fontSize={9} />
                </div>
                <div className="kds-pipe-sum-tables">{d.tables.join(', ')}</div>
              </div>
              <div className="kds-pipe-sum-detail">
                {d.doneQty > 0 && <span className="kds-pipe-sum-served">{d.doneQty} done</span>}
                {remaining > 0 ? (
                  <span className="kds-pipe-sum-remaining">{remaining} left</span>
                ) : (
                  <span className="kds-pipe-sum-served">All done</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
