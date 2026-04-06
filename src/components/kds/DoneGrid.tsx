'use client';

import { useState } from 'react';
import { useKds } from '@/lib/kds/state';
import { timerTier } from '@/lib/kds/priority';
import Timer from './Timer';

export default function DoneGrid() {
  const { orders, recall, settings } = useKds();
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const done = orders
    .filter(o => o.status === 'done')
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  if (done.length === 0) {
    return (
      <div className="kds-stage-grid">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u2705'}</div>
          <div>No completed orders</div>
        </div>
      </div>
    );
  }

  function doneTime(doneAt: number | null): string {
    if (!doneAt) return '';
    const min = Math.floor((Date.now() - doneAt) / 60000);
    return min > 0 ? `${min}m ago` : 'Just now';
  }

  function handleRecall(id: number) {
    recall(id);
    setConfirmId(null);
  }

  return (
    <>
      <div className="kds-stage-grid">
        {done.map(o => {
          const tier = timerTier(o.waitMin, o.type, settings);
          return (
            <div key={o.id} className="kds-stage-card done-card">
              <div className="kds-sc-head">
                <span>{o.table}</span>
                <Timer minutes={o.waitMin} tier={tier} size="md" />
              </div>
              <div className="kds-sc-items">
                {o.items.map(i => (
                  <div key={i.id} className="kds-sc-item">
                    <strong>{i.qty}x</strong>{i.name}
                  </div>
                ))}
              </div>
              <div className="kds-sc-foot">
                <span>Done: {doneTime(o.doneAt)}</span>
              </div>
              <button className="kds-sc-btn recall" onClick={() => setConfirmId(o.id)}>
                {'\u21BA'} RECALL
              </button>
            </div>
          );
        })}
      </div>

      {confirmId !== null && (() => {
        const o = orders.find(x => x.id === confirmId);
        if (!o) return null;
        return (
          <div className="kds-modal-bg" onClick={() => setConfirmId(null)}>
            <div className="kds-modal-box" onClick={e => e.stopPropagation()}>
              <h3>Recall {o.table}?</h3>
              <p>Back to preparation, all items reset.</p>
              <div className="kds-modal-btns">
                <button className="kds-m-cancel" onClick={() => setConfirmId(null)}>Keep</button>
                <button className="kds-m-danger" onClick={() => handleRecall(confirmId)}>Recall</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
