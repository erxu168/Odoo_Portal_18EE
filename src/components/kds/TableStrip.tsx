'use client';

import { useKds } from '@/lib/kds/state';
import { effectiveWait, timerTier, mostUrgentOrderId } from '@/lib/kds/priority';
import Timer from './Timer';

export default function TableStrip() {
  const { orders, roundState, firedOrderIds, settings, markReady } = useKds();
  const boost = settings.takeawayBoost;
  const prep = orders.filter(o => o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  if (prep.length === 0) {
    return (
      <div className="kds-table-strip">
        <span className="kds-table-strip-label">TABLES</span>
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
    <div className="kds-table-strip">
      <span className="kds-table-strip-label">TABLES</span>

      {fired.map(o => {
        const total = o.items.length;
        const done = o.items.filter(i => i.done).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const complete = done === total;
        const isNext = o.id === mui;
        const isTa = o.type === 'Takeaway';
        const tier = timerTier(o.waitMin, o.type, settings);

        return (
          <div
            key={o.id}
            className={`kds-table-chip ${isNext ? 'is-next' : ''} ${isTa ? 'is-takeaway' : ''} ${complete ? 'complete' : ''}`}
          >
            <div className="kds-tc-top">
              <div className="kds-tc-name">
                {isNext && <div className="kds-tc-next-dot" />}
                {o.table}
                {isTa && <span className="kds-tc-ta">TA</span>}
              </div>
              <Timer minutes={o.waitMin} tier={tier} size="sm" />
            </div>
            <div className="kds-tc-bar">
              <div className="kds-tc-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            {complete && (
              <button className="kds-tc-ready-btn" onClick={() => markReady(o.id)}>
                READY
              </button>
            )}
          </div>
        );
      })}

      {queued.map(o => {
        const isTa = o.type === 'Takeaway';
        return (
          <div key={o.id} className="kds-table-chip queued">
            <div className="kds-tc-top">
              <div className="kds-tc-name">
                {o.table}
                {isTa && <span className="kds-tc-ta">TA</span>}
              </div>
              <span className="kds-tc-queued-tag">NEXT ROUND</span>
            </div>
            <div className="kds-tc-bar">
              <div className="kds-tc-bar-fill" style={{ width: '0%' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
