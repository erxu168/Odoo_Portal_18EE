'use client';

import React from 'react';
import { useKds } from '@/lib/kds/state';
import { effectiveWait, timerTier, mostUrgentOrderId } from '@/lib/kds/priority';
import { SOURCES } from '@/types/kds';
import Timer from './Timer';

const TableStrip = React.forwardRef<HTMLDivElement>(function TableStrip(_props, ref) {
  const { orders, roundState, firedOrderIds, settings, markReady, toggleItem } = useKds();
  const boost = settings.takeawayBoost;
  const prep = orders.filter(o => o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  if (prep.length === 0) {
    return (
      <div className="kds-table-strip" ref={ref}>
        <span className="kds-table-strip-label">ORDERS</span>
      </div>
    );
  }

  const fired = roundState === 'active'
    ? orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost))
    : prep;
  const queued = roundState === 'active'
    ? prep.filter(o => !firedOrderIds.includes(o.id))
    : [];
  const mui = mostUrgentOrderId(fired, boost);

  return (
    <div className="kds-table-strip" ref={ref}>
      <span className="kds-table-strip-label">ORDERS</span>

      {fired.map(o => {
        const total = o.items.length;
        const done = o.items.filter(i => i.done).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const complete = done === total;
        const isNext = o.id === mui;
        const isTa = o.type === 'Takeaway';
        const tier = timerTier(o.waitMin, o.type, settings);

        return complete ? (
          <div
            key={o.id}
            className="kds-table-card complete"
          >
            <div className="kds-tc-top">
              <div className="kds-tc-name">
                {o.table}
                {isTa && <span className="kds-tc-ta">TA</span>}
              </div>
              <Timer minutes={o.waitMin} tier={tier} size="sm" />
            </div>
            <div className="kds-tc-items">
              {o.items.map(item => (
                <div key={item.id} className="kds-tc-item done" style={{ pointerEvents: 'none' }}>
                  <div className="kds-tc-check checked">
                    <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" width="14" height="14">
                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                    </svg>
                  </div>
                  <span className="kds-tc-item-qty">{item.qty}x</span>
                  <span className="kds-tc-item-name">{item.name}</span>
                </div>
              ))}
            </div>
            <button className="kds-tc-ready-btn" onClick={() => markReady(o.id)}>
              {'\u2705'} READY
            </button>
          </div>
        ) : (
          <div
            key={o.id}
            className={`kds-table-card ${isNext ? 'is-next' : ''} ${isTa ? 'is-takeaway' : ''}`}
          >
            <div className="kds-tc-top">
              <div className="kds-tc-name">
                {isNext && <div className="kds-tc-next-dot" />}
                {o.table}
                {isTa && <span className="kds-tc-ta">TA</span>}
              </div>
              <Timer minutes={o.waitMin} tier={tier} size="sm" />
            </div>

            <div className="kds-tc-items">
              {o.items.map(item => {
                const src = SOURCES[item.name];
                return (
                  <div
                    key={item.id}
                    className={`kds-tc-item ${item.done ? 'done' : ''}`}
                    onClick={() => toggleItem(item.id, o.id)}
                  >
                    <div className={`kds-tc-check ${item.done ? 'checked' : ''}`}>
                      {item.done && (
                        <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" width="14" height="14">
                          <path d="M3 8.5l3.5 3.5 6.5-7" />
                        </svg>
                      )}
                    </div>
                    <span className="kds-tc-item-qty">{item.qty}x</span>
                    <span className="kds-tc-item-name">{item.name}</span>
                    {src && (
                      <span className="kds-s-source" style={{ background: src.bg, color: src.color, fontSize: '9px' }}>
                        {src.label}
                      </span>
                    )}
                    {item.note && <span className="kds-tc-item-note">{item.note}</span>}
                  </div>
                );
              })}
            </div>

          </div>
        );
      })}

      {queued.map(o => {
        const isTa = o.type === 'Takeaway';
        return (
          <div key={o.id} className="kds-table-card queued">
            <div className="kds-tc-top">
              <div className="kds-tc-name">
                {o.table}
                {isTa && <span className="kds-tc-ta">TA</span>}
              </div>
              <span className="kds-tc-queued-tag">NEXT ROUND</span>
            </div>
            <div className="kds-tc-items">
              {o.items.map(item => (
                <div key={item.id} className="kds-tc-item" style={{ opacity: 0.4 }}>
                  <div className="kds-tc-check" />
                  <span className="kds-tc-item-qty">{item.qty}x</span>
                  <span className="kds-tc-item-name">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default TableStrip;
