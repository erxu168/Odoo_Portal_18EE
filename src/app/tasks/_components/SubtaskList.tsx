'use client';

import { TaskSubtask } from '@/lib/odoo-tasks';

interface Props {
  taskLineId: number;
  subtasks: TaskSubtask[];
  onToggle: (subtaskId: number, done: boolean) => void;
  readOnly?: boolean;
}

export default function SubtaskList({ subtasks, onToggle, readOnly = false }: Props) {
  if (!subtasks.length) return null;
  return (
    <ul className="mt-2 space-y-1 pl-1">
      {subtasks.map(sub => (
        <li key={sub.id}
          onClick={e => {
            if (readOnly) return;
            e.stopPropagation();
            onToggle(sub.id, !sub.done);
          }}
          className={`flex items-center gap-2 py-1.5 group ${readOnly ? '' : 'cursor-pointer'}`}>
          <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
            sub.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white group-hover:border-orange-400'
          }`}>
            {sub.done && (
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className={`text-sm transition-colors ${sub.done ? 'line-through text-gray-400' : 'text-gray-600'}`}>
            {sub.name}
          </span>
        </li>
      ))}
    </ul>
  );
}
