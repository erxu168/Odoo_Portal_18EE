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
  onDone,
}: {
  reminder: ActiveReminder | null;
  onSnooze: (taskId: number) => void;
  onDone: (taskId: number, name: string) => void;
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
        <div className="kds-task-reminder-actions">
          {reminder.photoRequired ? (
            <span className="kds-task-reminder-done disabled" aria-disabled="true">
              Needs photo — tablet
            </span>
          ) : (
            <button
              className="kds-task-reminder-done"
              onClick={() => onDone(reminder.id, reminder.name)}
            >
              Done
            </button>
          )}
          <button
            className="kds-task-reminder-snooze"
            onClick={() => onSnooze(reminder.id)}
          >
            Snooze 10 min
          </button>
        </div>
      </div>
    </div>
  );
}
