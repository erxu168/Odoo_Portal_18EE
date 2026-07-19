'use client';

import { useKds } from '@/lib/kds/state';
import { effectiveWait, timerTier } from '@/lib/kds/priority';
import { isAllergenOrAdditiveNote } from '@/lib/kds/notes';
import Timer from './Timer';
import SourceBadge from './SourceBadge';
import OrderTypePill from './OrderTypePill';

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
        const tier = timerTier(o.waitMin, o.type, settings);
        const allDone = o.items.every(i => i.done);
        // Count by quantity (units of food), not by number of dish lines.
        const done = o.items.filter(i => i.done).reduce((s, i) => s + i.qty, 0);
        const total = o.items.reduce((s, i) => s + i.qty, 0);

        return (
          <div key={o.id} className={`kds-stage-card tier-${tier} ${allDone ? 'ready' : ''}`}>
            <div className="kds-sc-head">
              <span className="kds-sc-ticket">{o.table}</span>
              <OrderTypePill type={o.type} />
              <Timer minutes={o.waitMin} tier={tier} size="md" />
            </div>
            <div className="kds-sc-items">
              {o.items.map(i => {
                const showNote = i.note && !isAllergenOrAdditiveNote(i.note);
                return (
                  <div
                    key={i.id}
                    className={`kds-sc-item ${i.done ? 'done' : ''}`}
                    onClick={() => toggleItem(i.id, o.id)}
                  >
                    <div className="kds-sc-item-main">
                      <span className={`kds-sc-check ${i.done ? 'checked' : ''}`}>
                        {i.done && (
                          <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" width="15" height="15">
                            <path d="M3 8.5l3.5 3.5 6.5-7" />
                          </svg>
                        )}
                      </span>
                      <span className="kds-sc-qty">{i.qty}x</span>
                      <span className="kds-sc-name">{i.name}</span>
                      <SourceBadge dishName={i.name} fontSize={9} />
                      {i.timerReady && (
                        <span
                          title="Cooked by the Cooking Timer"
                          style={{ marginLeft: 'auto', color: '#22c55e', fontWeight: 800, fontSize: 10, letterSpacing: '.5px', whiteSpace: 'nowrap' }}
                        >
                          ✓ COOKED
                        </span>
                      )}
                    </div>
                    {showNote && <div className="kds-note">{i.note}</div>}
                  </div>
                );
              })}
            </div>
            <div className="kds-sc-foot">
              <span>{done}/{total} items ready</span>
            </div>
            {allDone && (
              <button className="kds-sc-btn ready-btn" onClick={() => markReady(o.id)}>
                {'✅'} READY
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
