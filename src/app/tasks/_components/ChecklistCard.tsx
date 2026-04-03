'use client';

import { useState } from 'react';
import { ShiftTaskList } from '@/lib/odoo-tasks';
import TaskRow from './TaskRow';

interface Props {
  taskList: ShiftTaskList;
  onComplete: (taskId: number) => Promise<void>;
  onSubtaskToggle: (taskLineId: number, subtaskId: number, done: boolean) => Promise<void>;
  onPhotoUpload: (taskId: number) => Promise<void>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function ChecklistCard({ taskList, onComplete, onSubtaskToggle, onPhotoUpload }: Props) {
  const [showCompleted, setShowCompleted] = useState(true);

  const activeTasks    = taskList.task_lines.filter(t => t.state !== 'done');
  const completedTasks = taskList.task_lines.filter(t => t.state === 'done');
  const remaining      = activeTasks.length;

  return (
    <div className="mb-3">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
          <p className="font-bold text-sm text-gray-800">{taskList.template_name}</p>
          <span className="text-xs font-semibold text-gray-400">
            {remaining > 0 ? `${remaining} remaining` : 'All done!'}
          </span>
        </div>
        <div className="h-1 bg-gray-100 mx-4 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${taskList.completion_rate}%` }} />
        </div>

        {remaining > 0 ? (
          <div>
            {activeTasks.map(task => (
              <TaskRow key={task.id} task={task} taskListId={taskList.id}
                onComplete={onComplete} onSubtaskToggle={onSubtaskToggle} onPhotoUpload={onPhotoUpload} />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="text-4xl mb-2">🎉</div>
            <p className="font-bold text-green-600">All tasks complete!</p>
            <p className="text-xs text-gray-400 mt-1">Great work this shift.</p>
          </div>
        )}
      </div>

      {completedTasks.length > 0 && (
        <div className="mt-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => setShowCompleted(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700">
            <span className="flex items-center gap-2">
              <span>✅ Completed tasks</span>
              <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">{completedTasks.length}</span>
            </span>
            <span className="text-gray-400 text-xs">{showCompleted ? '▲' : '▼'}</span>
          </button>
          {showCompleted && (
            <ul className="border-t border-gray-100">
              {completedTasks.map(task => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500 line-through">{task.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Done at {task.completed_at ? formatTime(task.completed_at) : '—'}
                      {task.completed_by_name ? ` · ${task.completed_by_name}` : ''}
                      {task.photo_uploaded ? ' · 📸' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
