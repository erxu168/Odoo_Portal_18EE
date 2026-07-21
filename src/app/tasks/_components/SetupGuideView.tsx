'use client';

import { useState } from 'react';
import type { TaskListLine, TaskSubtask, SubtaskToggleResult } from '@/lib/odoo-tasks';
import PinnableImage from '@/components/ui/PinnableImage';

interface Props {
  task: TaskListLine;
  /** URL for one of the line's setup photos (multi-photo guides pass each seq). */
  photoUrlFor: (seq: number) => string;
  onSubtaskToggle: (lineId: number, subtaskId: number, done: boolean) => Promise<SubtaskToggleResult | void>;
  /** Called when the guide's completion state flips, so the parent can refresh the list. */
  onReload?: () => Promise<void> | void;
  readOnly?: boolean;
  /** Completed guides render collapsed with a "Review / adjust setup" expander. */
  defaultCollapsed?: boolean;
}

/**
 * Staff view of a setup guide: the annotated reference photo(s) + one numbered
 * check-off list. Pin numbers are GLOBAL across photos. Ticking every pin
 * auto-completes the task server-side; unchecking a pin on a completed guide
 * reopens it. Both transitions trigger a parent reload so the row moves
 * between the active and completed sections.
 */
export default function SetupGuideView({
  task, photoUrlFor, onSubtaskToggle, onReload, readOnly = false, defaultCollapsed = false,
}: Props) {
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>(
    [...task.subtasks].sort((a, b) => a.sequence - b.sequence || a.id - b.id),
  );
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [imgError, setImgError] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const wasCompleted = task.state === 'done';
  const doneCount = subtasks.filter(s => s.done).length;
  const total = subtasks.length;
  const allDone = total > 0 && doneCount === total;

  async function toggle(subtaskId: number, done: boolean) {
    if (readOnly || busy.has(subtaskId)) return;
    setError(null);
    setBusy(prev => new Set(prev).add(subtaskId));
    setSubtasks(prev => prev.map(s => s.id === subtaskId ? { ...s, done } : s));
    try {
      const res = await onSubtaskToggle(task.id, subtaskId, done);
      const lineCompleted = !!(res && 'line_completed' in res && res.line_completed);
      // Reload when completion flips so the row moves between sections.
      if (onReload && lineCompleted !== wasCompleted) await onReload();
    } catch (e) {
      setSubtasks(prev => prev.map(s => s.id === subtaskId ? { ...s, done: !done } : s));
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusy(prev => { const n = new Set(prev); n.delete(subtaskId); return n; });
    }
  }

  // Photos in display order; pins keep their GLOBAL index for numbering.
  const photoSeqs = task.setup_photo_seqs || [];
  const photoNo = (seq: number) => photoSeqs.indexOf(seq) + 1;

  return (
    <div className="mt-1">
      {defaultCollapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="text-xs font-semibold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1"
        >
          🧭 {collapsed ? 'Review / adjust setup' : 'Hide setup'}
        </button>
      )}

      {!collapsed && (
        <div className="mt-2 space-y-2">
          {photoSeqs.filter(seq => !imgError.has(seq)).map(seq => {
            const photoPins = subtasks
              .map((s, gi) => ({ s, gi }))
              .filter(({ s }) => (s.pin_photo_seq ?? 0) === seq);
            return (
              <div key={seq}>
                {photoSeqs.length > 1 && (
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">
                    📷 Photo {photoNo(seq)} of {photoSeqs.length}
                  </p>
                )}
                <div className="flex justify-center bg-gray-50 rounded-lg p-1">
                  <PinnableImage
                    src={photoUrlFor(seq)}
                    pins={photoPins.map(({ s, gi }) => ({
                      pin_x: s.pin_x, pin_y: s.pin_y, label: s.name, done: s.done, number: gi + 1,
                    }))}
                    mode="view"
                    activeIndex={activeIndex !== null ? photoPins.findIndex(p => p.gi === activeIndex) : null}
                    onPinClick={(i) => {
                      const gi = photoPins[i]?.gi;
                      setActiveIndex(a => a === gi ? null : gi ?? null);
                    }}
                    onImageError={() => setImgError(prev => new Set(prev).add(seq))}
                  />
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between px-0.5">
            <p className={`text-xs font-semibold ${allDone ? 'text-green-600' : 'text-gray-500'}`}>
              {allDone ? '✅ All items placed' : `${doneCount} / ${total} placed`}
            </p>
          </div>

          <ul className="space-y-1">
            {subtasks.map((s, i) => (
              <li
                key={s.id}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border ${
                  s.done ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
                } ${activeIndex === i ? 'ring-2 ring-orange-200' : ''}`}
              >
                <button
                  type="button"
                  disabled={readOnly || busy.has(s.id)}
                  onClick={() => toggle(s.id, !s.done)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 text-xs font-bold transition-colors disabled:opacity-60 ${
                    s.done ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-gray-300 text-gray-400'
                  }`}
                  aria-label={s.done ? `Uncheck ${s.name}` : `Check ${s.name}`}
                >
                  {s.done ? '✓' : i + 1}
                </button>
                <span className={`flex-1 text-sm ${s.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{s.name}</span>
              </li>
            ))}
          </ul>

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
