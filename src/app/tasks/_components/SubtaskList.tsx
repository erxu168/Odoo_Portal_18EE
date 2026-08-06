'use client';

import { useState } from 'react';
import { TaskSubtask } from '@/lib/odoo-tasks';
import PinnableImage from '@/components/ui/PinnableImage';
import { parseDrawings } from '@/lib/guide-drawings';

interface Props {
  taskLineId: number;
  subtasks: TaskSubtask[];
  onToggle: (subtaskId: number, done: boolean) => void;
  readOnly?: boolean;
}

export default function SubtaskList({ taskLineId, subtasks, onToggle, readOnly = false }: Props) {
  /** The subtask whose photo is open full-size, if any. */
  const [viewing, setViewing] = useState<TaskSubtask | null>(null);

  if (!subtasks.length) return null;

  const photoSrc = (sub: TaskSubtask) =>
    `/api/tasks/lines/${taskLineId}/subtasks/${sub.id}/photo`;

  return (
    <>
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
            sub.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 bg-white group-hover:border-green-600'
          }`}>
            {sub.done && (
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className={`flex-1 min-w-0 text-[var(--fs-sm)] transition-colors ${sub.done ? 'line-through text-gray-400' : 'text-gray-600'}`}>
            {sub.name}
          </span>
          {/* A thumbnail, not the photo itself: ten subtasks with ten full
              pictures stops the list being scannable on a phone. stopPropagation
              so opening the picture never ticks the subtask off by accident. */}
          {sub.has_photo && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setViewing(sub); }}
              aria-label={`Show the photo for ${sub.name}`}
              className="w-11 h-11 flex-shrink-0 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 active:scale-[0.97] transition-transform"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc(sub)} alt="" className="w-full h-full object-cover" />
            </button>
          )}
        </li>
      ))}
    </ul>

    {viewing && (
      <div
        className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
        onClick={() => setViewing(null)}
        role="dialog"
        aria-label={`Photo for ${viewing.name}`}
      >
        <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-white font-semibold text-[var(--fs-sm)] min-w-0 truncate">{viewing.name}</p>
            <button
              type="button"
              onClick={() => setViewing(null)}
              aria-label="Close"
              className="w-11 h-11 flex-shrink-0 rounded-full bg-white/15 text-white flex items-center justify-center active:bg-white/25"
            >
              <span aria-hidden="true" className="text-[var(--fs-lg)] leading-none">✕</span>
            </button>
          </div>
          <div className="flex justify-center">
            {/* Same component the guides use, in view mode: the marks are an
                overlay in fractional coordinates, so they land correctly at
                whatever size this dialog gives the photo. */}
            <PinnableImage
              src={photoSrc(viewing)}
              alt={`Photo for ${viewing.name}`}
              mode="view"
              pins={[]}
              drawings={parseDrawings(viewing.drawings)}
              imgClassName="max-h-[75vh] rounded-xl"
            />
          </div>
        </div>
      </div>
    )}
    </>
  );
}
