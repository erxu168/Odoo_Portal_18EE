'use client';

import { useKds } from '@/lib/kds/state';
import { timerTier, passMinutes, passTier } from '@/lib/kds/priority';
import Timer from './Timer';
import { useState, useEffect } from 'react';

export default function ReadyGrid() {
  const { orders, pickup, settings } = useKds();
  const [, setTick] = useState(0);

  // Re-render every 10s to update pass timers
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const ready = orders
    .filter(o => o.status === 'ready')
    .sort((a, b) => (a.readyAt || 0) - (b.readyAt || 0));

  if (ready.length === 0) {
    return (
      <div className="kds-stage-grid">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u23F3'}</div>
          <div>No orders waiting for pickup</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-stage-grid">
      {ready.map(o => {
        const isTa = o.type === 'Takeaway';
        const tier = timerTier(o.waitMin, o.type, settings);
        const pTier = o.readyAt ? passTier(o.readyAt, settings) : 'green';
        const passTime = o.readyAt ? passMinutes(o.readyAt) : 'Just now';

        return (
          <div key={o.id} className="kds-stage-card ready">
            <div className="kds-sc-head">
              <span>
                {o.table}
                {isTa && <> <span className="kds-s-takeaway">TAKEAWAY</span></>}
              </span>
              <Timer minutes={o.waitMin} tier={tier} size="md" />
            </div>
            <div className="kds-sc-items">
              {o.items.map(i => (
                <div key={i.id} className="kds-sc-item">
                  <strong>{i.qty}x</strong>
                  {i.name}
                  {i.note && <span style={{ color: 'var(--cooking)', fontSize: '10px' }}>{i.note}</span>}
                </div>
              ))}
            </div>
            <div className="kds-sc-foot">
              <span style={{ color: pTier === 'red' ? '#f87171' : pTier === 'orange' ? '#fb923c' : undefined }}>
                Ready: {passTime}
              </span>
            </div>
            <button className="kds-sc-btn pickup" onClick={() => pickup(o.id)}>
              PICKED UP
            </button>
          </div>
        );
      })}
    </div>
  );
}
