'use client';

import { useKds } from '@/lib/kds/state';
import { buildFirePlan, buildTaskGroups, effectiveWait, timerTier } from '@/lib/kds/priority';
import { isAllergenOrAdditiveNote } from '@/lib/kds/notes';
import { lookupSource } from '@/types/kds';
import type { FireLane, FireTask, KdsOrder, TaskGroup } from '@/types/kds';
import Timer from './Timer';
import TakeawayBag from './TakeawayBag';

export default function FirePlanView() {
  const { orders, firedOrderIds, settings, productConfig } = useKds();
  const boost = settings.takeawayBoost;

  const firedOrders = orders
    .filter(o => firedOrderIds.includes(o.id) && o.status === 'prep')
    .sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));

  // No orders left in the round at all (everything has been sent to the pass).
  if (firedOrders.length === 0) {
    return (
      <div className="kds-fire-plan">
        <div className="kds-empty">
          <div className="kds-empty-icon">{'✅'}</div>
          <div>All orders sent out</div>
        </div>
      </div>
    );
  }

  const lanes = buildFirePlan(firedOrders, boost, productConfig);
  // Dishes fully finished (across every order that needs them) — kept visible so
  // the cook can review and undo a wrong tap, instead of having them vanish.
  const doneTasks = buildTaskGroups(firedOrders, boost).filter(t => t.allDone);

  return (
    <div className="kds-fire-plan">
      {lanes.map(lane => (
        <LaneSection key={lane.prepType} lane={lane} />
      ))}

      {doneTasks.length > 0 && <DoneSection tasks={doneTasks} />}

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
  const { toggleItem, settings, productConfig } = useKds();
  const src = lookupSource(task.name, productConfig);
  const remaining = task.totalQty - task.doneQty;
  const allDone = remaining === 0;

  return (
    <div className={`kds-fp-task ${allDone ? 'all-done' : ''}`}>
      <div className="kds-fp-task-head">
        <span className="kds-fp-task-qty">{remaining > 0 ? `${remaining}x` : '✓'}</span>
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
                  <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" width="12" height="12">
                    <path d="M3 8.5l3.5 3.5 6.5-7" />
                  </svg>
                )}
              </div>
              <span className="kds-fp-entry-table">{entry.table}</span>
              <span className="kds-fp-entry-qty">{entry.qty}x</span>
              {entry.type === 'Takeaway' && <TakeawayBag size={16} />}
              <Timer minutes={entry.waitMin} tier={tier} size="sm" />
              {entry.note && !isAllergenOrAdditiveNote(entry.note) && <span className="kds-s-note">{entry.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DoneSection({ tasks }: { tasks: TaskGroup[] }) {
  const { toggleItem } = useKds();

  return (
    <div className="kds-fp-lane kds-fp-done-lane">
      <div className="kds-fp-lane-header">
        <span className="kds-fp-lane-emoji">{'✅'}</span>
        <span className="kds-fp-lane-label">DONE &mdash; tap to undo a mistake</span>
      </div>
      <div className="kds-fp-tasks">
        {tasks.map(task => (
          <div key={task.name} className="kds-fp-task">
            <div className="kds-fp-task-head">
              <span className="kds-fp-task-qty">{'✓'}</span>
              <span className="kds-fp-task-name">{task.name}</span>
            </div>
            <div className="kds-fp-task-tables">
              {task.entries.map(entry => (
                <div
                  key={`${entry.ticketId}:${entry.itemId}`}
                  className="kds-fp-entry done"
                  onClick={() => toggleItem(entry.itemId, entry.ticketId)}
                >
                  <div className="kds-fp-check checked">
                    <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" width="12" height="12">
                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                    </svg>
                  </div>
                  <span className="kds-fp-entry-table">{entry.table}</span>
                  <span className="kds-fp-entry-qty">{entry.qty}x</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PassReadiness({ orders }: { orders: KdsOrder[] }) {
  const { markReady } = useKds();
  if (orders.length === 0) return null;

  return (
    <div className="kds-fp-pass">
      <div className="kds-fp-pass-header">ORDER STATUS</div>
      <div className="kds-fp-pass-rows">
      {orders.map(o => {
        // Count by quantity (units of food), matching the lanes and progress rings.
        const doneQty = o.items.filter(i => i.done).reduce((s, i) => s + i.qty, 0);
        const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
        const allDone = o.items.every(i => i.done);

        return (
          <div key={o.id} className={`kds-fp-pass-row ${allDone ? 'ready' : ''}`}>
            <span className="kds-fp-pass-table">{o.table}</span>
            <span className="kds-fp-pass-status">
              {allDone ? '✅ Ready to serve' : `${doneQty}/${totalQty} done`}
            </span>
            <div className="kds-fp-pass-items">
              {o.items.map(i => (
                <div key={i.id} className={`kds-fp-pass-item ${i.done ? 'done' : ''}`}>
                  <span className="kds-fp-pass-item-check">
                    {i.done && (
                      <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="3" width="11" height="11">
                        <path d="M3 8.5l3.5 3.5 6.5-7" />
                      </svg>
                    )}
                  </span>
                  <span className="kds-fp-pass-item-qty">{i.qty}x</span>
                  <span className="kds-fp-pass-item-name">{i.name}</span>
                </div>
              ))}
            </div>
            {allDone && (
              <button className="kds-fp-pass-ready" onClick={() => markReady(o.id)}>
                Mark Ready
              </button>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
