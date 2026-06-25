'use client';

import { useKds } from '@/lib/kds/state';
import { timerTier, passMinutes, passTier } from '@/lib/kds/priority';
import { isAllergyNote } from '@/lib/kds/notes';
import Timer from './Timer';
import OrderTypePill from './OrderTypePill';
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
        const tier = timerTier(o.waitMin, o.type, settings);
        const pTier = o.readyAt ? passTier(o.readyAt, settings) : 'green';
        const passTime = o.readyAt ? passMinutes(o.readyAt) : 'Just now';

        return (
          <div key={o.id} className="kds-stage-card ready">
            <div className="kds-sc-head">
              <span className="kds-sc-ticket">{o.table}</span>
              <OrderTypePill type={o.type} />
              <Timer minutes={o.waitMin} tier={tier} size="md" />
            </div>
            <div className="kds-sc-items">
              {o.items.map(i => {
                const allergy = isAllergyNote(i.note);
                return (
                  <div key={i.id} className="kds-sc-item">
                    <div className="kds-sc-item-main">
                      <span className="kds-sc-qty">{i.qty}x</span>
                      <span className="kds-sc-name">{i.name}</span>
                    </div>
                    {i.note && (
                      <div className={`kds-note ${allergy ? 'allergy' : ''}`}>
                        {allergy ? `⚠ ${i.note}` : i.note}
                      </div>
                    )}
                  </div>
                );
              })}
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
