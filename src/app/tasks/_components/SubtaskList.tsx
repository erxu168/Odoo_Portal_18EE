'use client';

import { TaskSubtask } from '@/lib/odoo-tasks';
import AnnotatedPhotoThumb from '@/components/ui/AnnotatedPhotoThumb';

interface Props {
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
          // The most-tapped control in the module, and it was a 16px box in a
          // 30px row. A miss lands on the task row behind it, which answers with
          // "complete the subtasks first" — so a fat-fingered tap on a wet
          // tablet reads as the app refusing to cooperate.
          className={`flex items-center gap-2 py-2 min-h-[44px] group ${readOnly ? '' : 'cursor-pointer'}`}>
          <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
            sub.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white group-hover:border-green-600'
          }`}>
            {sub.done && (
              <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className={`flex-1 min-w-0 text-[var(--fs-sm)] transition-colors ${sub.done ? 'line-through text-gray-400' : 'text-gray-600'}`}>
            {sub.name}
          </span>
          {/* A thumbnail, not the photo itself: ten subtasks with ten full
              pictures stops the list being scannable on a phone. The URL comes
              from whoever read the record — this list must not guess it, since
              the manager's preview hands it fabricated ids. */}
          <AnnotatedPhotoThumb src={sub.photo_url} drawings={sub.drawings} label={sub.name} />
        </li>
      ))}
    </ul>
  );
}
