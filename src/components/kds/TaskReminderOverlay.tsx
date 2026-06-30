'use client';

import type { ActiveReminder } from '@/lib/kds/taskReminders';

/**
 * Big, glanceable task reminder that pops over the board and fades.
 * The card itself lets taps pass through to the orders underneath — only the
 * Snooze button is interactive — so it never blocks the kitchen.
 */
export default function TaskReminderOverlay({
  reminder,
  onSnooze,
}: {
  reminder: ActiveReminder | null;
  onSnooze: (taskId: number) => void;
}) {
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
        <button
          className="kds-task-reminder-snooze"
          onClick={() => onSnooze(reminder.id)}
        >
          Snooze 10 min
        </button>
      </div>
    </div>
  );
}
