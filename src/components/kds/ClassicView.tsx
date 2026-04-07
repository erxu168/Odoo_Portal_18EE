'use client';

import { useKds } from '@/lib/kds/state';
import { effectiveWait, timerTier } from '@/lib/kds/priority';
import Timer from './Timer';
import SourceBadge from './SourceBadge';
import TakeawayBag from './TakeawayBag';

export default function ClassicView() {
  const { orders, settings, toggleItem, markReady } = useKds();
  const boost = settings.takeawayBoost;
  const prep = orders
    .filter(o => o.status === 'prep')
    .sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  if (prep.length === 0) {
    return (
      <div className="kds-stage-grid">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u{1F389}'}</div>
          <div>All orders served!</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-stage-grid">
      {prep.map(o => {
        const isTa = o.type === 'Takeaway';
        const tier = timerTier(o.waitMin, o.type, settings);
        const allDone = o.items.every(i => i.done);
        const done = o.items.filter(i => i.done).length;
        const total = o.items.length;

        return (
          <div key={o.id} className={`kds-stage-card ${allDone ? 'ready' : ''}`}>
            <div className="kds-sc-head">
              <span>
                {o.table}
                {isTa && <> <TakeawayBag /></>}
              </span>
              <Timer minutes={o.waitMin} tier={tier} size="md" />
            </div>
            <div className="kds-sc-items">
              {o.items.map(i => (
                <div
                  key={i.id}
                  className="kds-sc-item"
                  style={{ cursor: 'pointer', opacity: i.done ? 0.3 : 1, textDecoration: i.done ? 'line-through' : 'none' }}
                  onClick={() => toggleItem(i.id, o.id)}
                >
                  <strong>{i.qty}x</strong>
                  {i.name}
                  <SourceBadge dishName={i.name} fontSize={9} />
                  {i.note && <span style={{ color: 'var(--cooking)', fontSize: '10px' }}>{i.note}</span>}
                </div>
              ))}
            </div>
            <div className="kds-sc-foot">
              <span>{done}/{total} items</span>
            </div>
            {allDone && (
              <button className="kds-sc-btn pickup" onClick={() => markReady(o.id)}>
                READY
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
