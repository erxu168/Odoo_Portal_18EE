'use client';

import { useKds } from '@/lib/kds/state';
import { buildFirePlan, effectiveWait, timerTier } from '@/lib/kds/priority';
import { SOURCES } from '@/types/kds';
import type { FireLane, FireTask, KdsOrder } from '@/types/kds';
import Timer from './Timer';
import TakeawayBag from './TakeawayBag';

export default function FirePlanView() {
  const { orders, firedOrderIds, settings, productConfig } = useKds();
  const boost = settings.takeawayBoost;

  const firedOrders = orders
    .filter(o => firedOrderIds.includes(o.id) && o.status === 'prep')
    .sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  const lanes = buildFirePlan(firedOrders, boost, productConfig);

  if (lanes.length === 0) {
    return (
      <div className="kds-fire-plan">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'\u2705'}</div>
          <div>{'All items served \u2014 mark tables Ready'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-fire-plan">
      {lanes.map(lane => (
        <LaneSection key={lane.prepType} lane={lane} />
      ))}

      <PassReadiness orders={firedOrders} />
    </div>
  );
}

function LaneSection({ lane }: { lane: FireLane }) {
  return (
    <div className={`kds-fp-lane kds-fp-lane--${lane.prepType}`}>
      <div className="kds-fp-lane-header">
        <span className="kds-fp-lane-emoji">{lane.emoji}</span>
        <span className="kds-fp-lane-label">{lane.label}</span>
      </div>
      <div className="kds-fp-tasks">
        {lane.tasks.map(task => (
          <TaskRow key={task.name} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: FireTask }) {
  const { toggleItem, settings } = useKds();
  const src = SOURCES[task.name];
  const remaining = task.totalQty - task.doneQty;
  const allDone = remaining === 0;

  return (
    <div className={`kds-fp-task ${allDone ? 'all-done' : ''}`}>
      <div className="kds-fp-task-head">
        <span className="kds-fp-task-qty">{remaining > 0 ? `${remaining}x` : '\u2713'}</span>
        <span className="kds-fp-task-name">{task.name}</span>
        {src && (
          <span className="kds-s-source" style={{ background: src.bg, color: src.color, fontSize: '9px' }}>
            {src.label}
          </span>
        )}
      </div>
      <div className="kds-fp-task-tables">
        {task.entries.map(entry => {
          const tier = timerTier(entry.waitMin, entry.type, settings);
          return (
            <div
              key={`${entry.ticketId}:${entry.itemId}`}
              className={`kds-fp-entry ${entry.done ? 'done' : ''}`}
              onClick={() => toggleItem(entry.itemId, entry.ticketId)}
            >
              <div className={`kds-fp-check ${entry.done ? 'checked' : ''}`}>
                {entry.done && (
                  <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" width="10" height="10">
                    <path d="M3 8.5l3.5 3.5 6.5-7" />
                  </svg>
                )}
              </div>
              <span className="kds-fp-entry-qty">{entry.qty}x</span>
              <span className="kds-fp-entry-table">{entry.table}</span>
              {entry.type === 'Takeaway' && <TakeawayBag />}
              <Timer minutes={entry.waitMin} tier={tier} size="sm" />
              {entry.note && <span className="kds-s-note">{entry.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PassReadiness({ orders }: { orders: KdsOrder[] }) {
  if (orders.length === 0) return null;

  return (
    <div className="kds-fp-pass">
      <div className="kds-fp-pass-header">PASS READINESS</div>
      {orders.map(o => {
        const done = o.items.filter(i => i.done).length;
        const total = o.items.length;
        const allDone = done === total;
        const waiting = o.items.filter(i => !i.done).map(i => i.name);

        return (
          <div key={o.id} className={`kds-fp-pass-row ${allDone ? 'ready' : ''}`}>
            <span className="kds-fp-pass-table">{o.table}</span>
            <span className="kds-fp-pass-status">
              {allDone ? '\u2705 READY' : `${done}/${total} \u2014 waiting: ${waiting.join(', ')}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
