'use client';

import { useKds } from '@/lib/kds/state';

export default function FireBar() {
  const { orders, roundState, firedOrderIds, fireRound, nextRound } = useKds();
  const prep = orders.filter(o => o.status === 'prep');
  const roundOrders = orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep');
  const queued = prep.filter(o => !firedOrderIds.includes(o.id));
  const allPlated = roundOrders.every(o => o.items.every(i => i.done));
  const roundComplete = roundState === 'active' && (roundOrders.length === 0 || allPlated);

  if (roundState === 'idle') {
    if (prep.length === 0) {
      return (
        <div className="kds-fire-bar">
          <div className="kds-fire-status">No orders to fire</div>
        </div>
      );
    }
    return (
      <div className="kds-fire-bar">
        <button className="kds-fire-btn ready-to-fire" onClick={fireRound}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" />
            <path d="M12 18v3" />
          </svg>
          FIRE ROUND
        </button>
        <div className="kds-fire-status">
          <strong>{prep.length} orders</strong> ready -- review and fire when ready
        </div>
      </div>
    );
  }

  const activeLeft = roundOrders.filter(o => !o.items.every(i => i.done)).length;

  return (
    <div className="kds-fire-bar">
      {roundComplete ? (
        <button className="kds-fire-btn round-done" onClick={nextRound}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          NEXT ROUND
        </button>
      ) : (
        <div className="kds-fire-btn round-active">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l3 3" />
          </svg>
          ROUND ACTIVE
        </div>
      )}
      <div className="kds-fire-status">
        {roundComplete ? (
          <><strong>Round complete!</strong> Tap to load next orders.</>
        ) : (
          <><strong>{activeLeft} tables</strong> still plating in this round</>
        )}
      </div>
      {queued.length > 0 && (
        <div className="kds-next-round-badge has-orders">
          Next round: <span className="kds-nrb-count">{queued.length}</span> orders waiting
        </div>
      )}
    </div>
  );
}
