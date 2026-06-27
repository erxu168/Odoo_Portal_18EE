'use client';

import type { ActiveReminder } from '@/lib/kds/taskReminders';

/**
 * Big, glanceable task reminder that pops over the board and fades.
 * Purely informational (pointer-events: none) — it never blocks the orders.
 */
export default function TaskReminderOverlay({ reminder }: { reminder: ActiveReminder | null }) {
  if (!reminder) return null;
  const dueLabel = reminder.overdue ? 'OVERDUE' : `Due in ${reminder.dueInMin} min`;
  return (
    <div
      key={reminder.showId}
      className={`kds-task-reminder ${reminder.overdue ? 'overdue' : 'upcoming'}`}
    >
      <div className="kds-task-reminder-card">
        <div className="kds-task-reminder-icon">{'⚠'}</div>
        <div className="kds-task-reminder-text">{reminder.name}</div>
        <div className="kds-task-reminder-due">{dueLabel}</div>
      </div>
    </div>
  );
}
