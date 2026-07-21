'use client';

import { useState } from 'react';
import { TaskList, TaskListLine, DayPart, SubtaskToggleResult } from '@/lib/odoo-tasks';
import TaskRow, { setupPhotoUrlFor } from './TaskRow';
import SetupGuideView from './SetupGuideView';

interface Props {
  taskList: TaskList;
  onComplete: (taskId: number) => Promise<void>;
  onSubtaskToggle: (taskLineId: number, subtaskId: number, done: boolean) => Promise<SubtaskToggleResult | void>;
  onPhotoUpload: (taskId: number) => Promise<void>;
  onNoteSave?: (taskId: number, note: string) => Promise<void>;
  /** Refresh the list — used so setup-guide auto-complete/reopen moves rows between sections. */
  onReload?: () => Promise<void> | void;
  readOnly?: boolean;
}

const DAY_PART_LABEL: Record<DayPart, string> = {
  opening: 'Opening',
  mid_day: 'Mid-day',
  closing: 'Closing',
};

const DAY_PART_ICON: Record<DayPart, string> = {
  opening: '\u{1F305}',
  mid_day: '☀️',
  closing: '\u{1F319}',
};

const DAY_PART_ORDER: DayPart[] = ['opening', 'mid_day', 'closing'];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function ChecklistCard({ taskList, onComplete, onSubtaskToggle, onPhotoUpload, onNoteSave, onReload, readOnly = false }: Props) {
  const grouped: Record<DayPart, TaskListLine[]> = { opening: [], mid_day: [], closing: [] };
  for (const line of taskList.lines) grouped[line.day_part].push(line);

  return (
    <div className="space-y-3">
      {DAY_PART_ORDER.map(part => {
        const lines = grouped[part];
        if (lines.length === 0) return null;
        return (
          <DayPartSection
            key={part}
            part={part}
            lines={lines}
            taskListId={taskList.id}
            onComplete={onComplete}
            onSubtaskToggle={onSubtaskToggle}
            onPhotoUpload={onPhotoUpload}
            onNoteSave={onNoteSave}
            onReload={onReload}
            readOnly={readOnly}
          />
        );
      })}
    </div>
  );
}

interface SectionProps {
  part: DayPart;
  lines: TaskListLine[];
  taskListId: number;
  onComplete: Props['onComplete'];
  onSubtaskToggle: Props['onSubtaskToggle'];
  onPhotoUpload: Props['onPhotoUpload'];
  onNoteSave: Props['onNoteSave'];
  onReload: Props['onReload'];
  readOnly: boolean;
}

function DayPartSection({ part, lines, taskListId, onComplete, onSubtaskToggle, onPhotoUpload, onNoteSave, onReload, readOnly }: SectionProps) {
  const [open, setOpen] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const active    = lines.filter(t => t.state !== 'done');
  const completed = lines.filter(t => t.state === 'done');
  const remaining = active.length;
  const rate = lines.length ? Math.round(completed.length / lines.length * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 pt-3.5 pb-2 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0">{DAY_PART_ICON[part]}</span>
          <p className="font-bold text-sm text-gray-800">{DAY_PART_LABEL[part]}</p>
          <span className="text-xs font-semibold text-gray-400 truncate">
            {remaining > 0 ? `${remaining} remaining` : 'All done'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-bold ${rate === 100 ? 'text-green-600' : 'text-gray-500'}`}>{rate}%</span>
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      <div className="h-1 bg-gray-100 mx-4 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-green-500 rounded-full transition-all duration-500"
          style={{ width: `${rate}%` }}
        />
      </div>

      {open && (
        <>
          {active.length > 0 ? (
            <div>
              {active.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  taskListId={taskListId}
                  onComplete={onComplete}
                  onSubtaskToggle={onSubtaskToggle}
                  onPhotoUpload={onPhotoUpload}
                  onNoteSave={onNoteSave}
                  onReload={onReload}
                  readOnly={readOnly}
                />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center">
              <div className="text-3xl mb-1">🎉</div>
              <p className="font-bold text-green-600 text-sm">All {DAY_PART_LABEL[part].toLowerCase()} tasks complete</p>
            </div>
          )}

          {completed.length > 0 && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowCompleted(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700"
              >
                <span className="flex items-center gap-2">
                  <span>✅ Completed</span>
                  <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{completed.length}</span>
                </span>
                <span className="text-gray-400 text-xs">{showCompleted ? '▲' : '▼'}</span>
              </button>
              {showCompleted && (
                <ul className="border-t border-gray-100">
                  {completed.map(task => (
                    <li key={task.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                      <div className="mt-0.5 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-white" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-500 line-through">{task.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Done at {task.completed_at ? formatTime(task.completed_at) : '—'}
                          {task.completed_by_name ? ` · ${task.completed_by_name}` : ''}
                          {task.photo_uploaded ? ' · \u{1F4F8}' : ''}
                        </p>
                        {task.is_setup_guide && (
                          <SetupGuideView
                            task={task}
                            photoUrlFor={setupPhotoUrlFor(task)}
                            onSubtaskToggle={onSubtaskToggle}
                            onReload={onReload}
                            readOnly={readOnly}
                            defaultCollapsed
                          />
                        )}
                        {task.note && (
                          <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-xs text-yellow-900">
                            <span className="font-semibold">📝 Note: </span>{task.note}
                            {task.note_by_name && (
                              <span className="block text-[10px] text-yellow-700 mt-0.5">— {task.note_by_name}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
