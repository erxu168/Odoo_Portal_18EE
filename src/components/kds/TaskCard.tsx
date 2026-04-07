'use client';

import { useKds } from '@/lib/kds/state';
import { SOURCES } from '@/types/kds';
import type { TaskGroup } from '@/types/kds';
import Timer from './Timer';
import SourceBadge from './SourceBadge';
import TakeawayBag from './TakeawayBag';
import { timerTier, getTableRemaining } from '@/lib/kds/priority';

interface TaskCardProps {
  task: TaskGroup;
  isPriority: boolean;
  mostUrgentId: number | null;
}

export default function TaskCard({ task, isPriority, mostUrgentId }: TaskCardProps) {
  const { toggleItem, orders, settings } = useKds();
  const pct = task.totalQty > 0 ? Math.round((task.servedQty / task.totalQty) * 100) : 0;
  const r = 14;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const srcInfo = SOURCES[task.name];

  return (
    <div
      className={`kds-task-card ${isPriority ? 'is-priority' : ''} ${task.allDone ? 'all-served' : ''}`}
      style={{ borderTop: `3px solid ${srcInfo?.color || '#64748b'}` }}
    >
      {isPriority && <div className="kds-priority-banner">NEXT</div>}

      <div className="kds-task-header">
        <div className="kds-task-dish">
          <div>
            <span className="kds-task-qty">
              {task.remainQty}<span className="kds-task-qty-unit">x</span>
            </span>
          </div>
          <div>
            <div className="kds-task-name">{task.name}</div>
            <SourceBadge dishName={task.name} />
            {task.entries.length === 1 && <span className="kds-task-solo-tag">SINGLE</span>}
          </div>
        </div>

        <svg className="kds-task-ring" width="42" height="42" viewBox="0 0 38 38">
          <circle cx="19" cy="19" r={r} fill="none" stroke="#1e293b" strokeWidth="3" />
          <circle
            cx="19" cy="19" r={r} fill="none"
            stroke={task.allDone ? 'var(--ready)' : '#3b82f6'}
            strokeWidth="3" strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 19 19)"
          />
          <text x="19" y="22" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--text)">
            {task.servedQty}/{task.totalQty}
          </text>
        </svg>
      </div>

      <div className="kds-task-divider" />

      <div className="kds-serve-queue">
        <div className="kds-serve-label">Plate for</div>
        {task.entries.map((entry) => {
          const showNext = entry.ticketId === mostUrgentId && !entry.done;
          const otherItems = showNext
            ? getTableRemaining(orders, entry.ticketId).filter(i => i.name !== task.name)
            : [];
          const isTa = entry.type === 'Takeaway';
          const tier = timerTier(entry.waitMin, entry.type, settings);

          return (
            <div key={entry.itemId}>
              <div
                className={`kds-serve-item ${entry.done ? 'served' : ''} ${showNext ? 'is-next' : ''}`}
                onClick={() => toggleItem(entry.itemId, entry.ticketId)}
              >
                <div className={`kds-s-check ${entry.done ? 'checked' : ''}`}>
                  {entry.done && (
                    <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="2.5" width="12" height="12">
                      <path d="M3 8.5l3.5 3.5 6.5-7" />
                    </svg>
                  )}
                </div>
                {showNext && <span className="kds-next-tag">NEXT</span>}
                <span className="kds-s-table">{entry.table}</span>
                {isTa && <TakeawayBag />}
                <span className="kds-s-qty">{entry.qty}x</span>
                {entry.note && <span className="kds-s-note">{entry.note}</span>}
                <Timer minutes={entry.waitMin} tier={tier} size="sm" />
              </div>
              {showNext && otherItems.length > 0 && (
                <div className="kds-also-needs">
                  {'\u26A0'} {entry.table} also needs: {otherItems.map(i => `${i.qty}x ${i.name}`).join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="kds-task-progress">
        <div className="kds-task-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
