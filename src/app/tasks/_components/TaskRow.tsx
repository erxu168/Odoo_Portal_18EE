'use client';

import { useState } from 'react';
import { TaskListLine, TaskSubtask, ModuleLink, SubtaskToggleResult } from '@/lib/odoo-tasks';
import SubtaskList from './SubtaskList';
import AttachmentList from './AttachmentList';
import SetupGuideView from './SetupGuideView';

interface Props {
  task: TaskListLine;
  taskListId: number;
  onComplete: (taskId: number) => Promise<void>;
  onSubtaskToggle: (taskLineId: number, subtaskId: number, done: boolean) => Promise<SubtaskToggleResult | void>;
  onPhotoUpload: (taskId: number) => Promise<void>;
  onNoteSave?: (taskId: number, note: string) => Promise<void>;
  onReload?: () => Promise<void> | void;
  readOnly?: boolean;
}

const MODULE_STYLES: Record<ModuleLink, string> = {
  none:          '',
  purchase:      'bg-amber-50 text-amber-800 border-amber-200',
  inventory:     'bg-green-50  text-green-800  border-green-200',
  pos:           'bg-blue-50   text-blue-800   border-blue-200',
  manufacturing: 'bg-orange-50 text-orange-800 border-orange-200',
};
const MODULE_ICONS: Record<ModuleLink, string> = {
  none: '',
  purchase: '\u{1F6D2}',
  inventory: '\u{1F4E6}',
  pos: '\u{1F5A5}️',
  manufacturing: '\u{1F3ED}',
};
const MODULE_LABELS: Record<ModuleLink, string> = {
  none: '',
  purchase: 'Open Purchase',
  inventory: 'Open Inventory',
  pos: 'Open POS',
  manufacturing: 'Open Manufacturing',
};
const MODULE_HREFS: Record<ModuleLink, string | null> = {
  none: null,
  purchase: '/purchase',
  inventory: '/inventory',
  pos: null,
  manufacturing: '/manufacturing',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function TaskRow({ task, taskListId: _taskListId, onComplete, onSubtaskToggle, onPhotoUpload, onNoteSave, onReload, readOnly = false }: Props) {
  const [subtasks, setSubtasks]     = useState<TaskSubtask[]>(task.subtasks);
  // Count of photos uploaded against this task — derived from runtime-scoped image attachments
  // plus a transient "just uploaded" counter for instant feedback before the parent reload settles.
  const persistedPhotos = task.attachments.filter(
    a => a.scope === 'task' && (a.mimetype || '').startsWith('image/'),
  ).length;
  const [justUploaded, setJustUploaded] = useState(0);
  const photoCount = persistedPhotos + justUploaded;
  const photoUploaded = photoCount > 0;
  const [uploading, setUploading]   = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [note, setNote]             = useState(task.note ?? '');
  const [noteOpen, setNoteOpen]     = useState(!!task.note);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteDirty, setNoteDirty]   = useState(false);

  if (task.state === 'done') return null;

  // Setup guides are pin-driven: no tap-to-complete row — the SetupGuideView
  // owns the photo, the check-off list, and auto-completion.
  if (task.is_setup_guide) {
    return (
      <div className="relative px-4 py-3.5 border-b border-gray-100 last:border-0">
        {task.is_ad_hoc && <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" aria-hidden="true" />}
        <div className="flex items-start justify-between gap-2">
          <p className={`font-semibold text-sm leading-snug ${task.state === 'overdue' ? 'text-red-700' : 'text-gray-800'}`}>
            {task.name}
          </p>
          <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full flex-shrink-0">
            📍 Setup guide
          </span>
        </div>
        {task.deadline_datetime && (
          <span className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
            task.state === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
          }`}>
            {task.state === 'overdue' ? '⚠ Overdue' : `⏱ By ${formatTime(task.deadline_datetime)}`}
          </span>
        )}
        <SetupGuideView
          task={task}
          photoUrl={task.has_setup_photo ? `/api/tasks/lines/${task.id}/setup-photo` : null}
          onSubtaskToggle={onSubtaskToggle}
          onReload={onReload}
          readOnly={readOnly}
        />
      </div>
    );
  }

  const allSubtasksDone = subtasks.length === 0 || subtasks.every(s => s.done);
  const isLocked        = subtasks.length > 0 && !allSubtasksDone;
  const needsPhoto      = task.photo_required && !photoUploaded;

  const overdueMinutes = task.state === 'overdue' && task.deadline_datetime
    ? Math.round((Date.now() - new Date(task.deadline_datetime).getTime()) / 60000)
    : 0;

  async function handleTap() {
    if (readOnly) return;
    setError(null);
    if (isLocked) {
      const left = subtasks.filter(s => !s.done).length;
      setError(`Complete ${left} subtask${left > 1 ? 's' : ''} first`);
      return;
    }
    if (needsPhoto) {
      setError('Photo required before completing this task');
      return;
    }
    setCompleting(true);
    try { await onComplete(task.id); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed'); setCompleting(false); }
  }

  async function handleSubtask(subtaskId: number, done: boolean) {
    setSubtasks(prev => prev.map(s => s.id === subtaskId ? { ...s, done } : s));
    try { await onSubtaskToggle(task.id, subtaskId, done); }
    catch { setSubtasks(prev => prev.map(s => s.id === subtaskId ? { ...s, done: !done } : s)); }
  }

  async function handleSaveNote(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onNoteSave) return;
    setNoteSaving(true);
    try {
      await onNoteSave(task.id, note);
      setNoteDirty(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setNoteSaving(false);
    }
  }

  async function handlePhoto(e: React.MouseEvent) {
    e.stopPropagation();
    setUploading(true);
    try {
      await onPhotoUpload(task.id);
      // Optimistic bump; the parent reload will refresh task.attachments and
      // make this counter redundant, but it removes a one-second blank period.
      setJustUploaded(n => n + 1);
      setError(null);
    } catch (err: unknown) {
      // Don't surface an error if the user just dismissed the camera.
      const cancelled = !!(err && typeof err === 'object' && 'cancelled' in err);
      if (!cancelled) setError(err instanceof Error ? err.message : 'Photo upload failed');
    }
    finally { setUploading(false); }
  }

  const linkLabel = task.module_link_type !== 'none' ? MODULE_LABELS[task.module_link_type] : '';
  const linkHref = task.module_link_type !== 'none' ? MODULE_HREFS[task.module_link_type] : null;

  return (
    <div onClick={handleTap}
      className={`relative flex items-start gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors ${readOnly ? '' : 'cursor-pointer'} ${
        completing ? 'opacity-40 pointer-events-none' :
        task.is_ad_hoc ? 'bg-amber-50 hover:bg-amber-100/60' :
        (readOnly ? '' : 'hover:bg-orange-50/30')
      }`}>

      {task.is_ad_hoc && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" aria-hidden="true" />
      )}

      <div className={`mt-0.5 w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-all text-xs font-bold ${
        isLocked ? 'border-gray-200 bg-gray-50 text-gray-400' :
        task.state === 'overdue' ? 'border-red-400 bg-red-50 text-red-500' :
        task.is_ad_hoc ? 'border-amber-400 bg-white' :
        'border-gray-300 bg-white'
      }`}>
        {isLocked ? '\u{1F512}' : task.state === 'overdue' ? '!' : ''}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`font-semibold text-sm leading-snug ${task.state === 'overdue' ? 'text-red-700' : 'text-gray-800'}`}>
            {task.name}
          </p>
          {task.is_ad_hoc && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white flex-shrink-0 uppercase tracking-wide">
              ⭐ One-off
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {task.deadline_datetime && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              task.state === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
            }`}>
              {task.state === 'overdue' ? `⚠ Overdue ${overdueMinutes} min` : `⏱ By ${formatTime(task.deadline_datetime)}`}
            </span>
          )}
          {task.photo_required && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700">
              📸 required
            </span>
          )}
        </div>

        {subtasks.length > 0 && (
          <p className={`text-xs mt-1.5 font-medium ${
            allSubtasksDone ? 'text-green-600' : 'text-gray-400'
          }`}>
            {allSubtasksDone ? 'All subtasks done — tap to complete ✓' : `Complete ${subtasks.filter(s=>!s.done).length} more subtask${subtasks.filter(s=>!s.done).length > 1?'s':''} to unlock`}
          </p>
        )}

        <SubtaskList taskLineId={task.id} subtasks={subtasks} onToggle={handleSubtask} readOnly={readOnly} />

        {task.attachments.length > 0 && (
          <AttachmentList attachments={task.attachments} compact />
        )}

        {task.module_link_type !== 'none' && linkHref && (
          <a href={linkHref} onClick={e => e.stopPropagation()}
            className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:shadow-sm ${MODULE_STYLES[task.module_link_type]}`}>
            {MODULE_ICONS[task.module_link_type]} {linkLabel} ↗
          </a>
        )}

        {!readOnly && task.photo_required && allSubtasksDone && (
          <>
            {task.photo_instructions && photoCount === 0 && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs leading-snug">
                <span className="font-bold">📋 Photo guide: </span>{task.photo_instructions}
              </div>
            )}
            {photoCount > 0 && (
              <div className="mt-2 flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-semibold">
                <span>✅ {photoCount} photo{photoCount === 1 ? '' : 's'} uploaded</span>
                <span className="text-green-600/80 font-medium">— tap task to complete, or add more below</span>
              </div>
            )}
            <button onClick={handlePhoto} disabled={uploading}
              className="mt-2 w-full py-2.5 border-2 border-dashed border-orange-400 rounded-lg bg-orange-50 text-orange-700 text-xs font-semibold text-center hover:bg-orange-100 transition-colors disabled:opacity-60">
              {uploading ? '⏳ Uploading...' : photoCount === 0 ? '\u{1F4F8} Tap to take / upload photo' : '\u{1F4F8} Add another photo'}
            </button>
          </>
        )}

        {!readOnly && onNoteSave && (
          <div className="mt-2" onClick={e => e.stopPropagation()}>
            {!noteOpen && !task.note ? (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="text-xs font-semibold text-gray-500 hover:text-orange-600 inline-flex items-center gap-1"
              >
                📝 Add note
              </button>
            ) : (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-2">
                <textarea
                  value={note}
                  onChange={e => { setNote(e.target.value); setNoteDirty(true); }}
                  placeholder="e.g. ran out of bleach, fryer making noise…"
                  rows={2}
                  className="w-full text-xs px-2 py-1.5 border border-yellow-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 resize-y min-h-[44px]"
                />
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <span className="text-[10px] text-yellow-700">
                    {task.note_by_name && task.note_at && !noteDirty
                      ? `Saved by ${task.note_by_name} at ${formatTime(task.note_at)}`
                      : noteDirty ? 'Unsaved changes' : ''}
                  </span>
                  <div className="flex gap-1.5">
                    {!task.note && !noteDirty && (
                      <button
                        type="button"
                        onClick={() => { setNote(''); setNoteOpen(false); }}
                        className="text-[11px] text-gray-500 px-2 py-1 rounded-md hover:bg-yellow-100"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveNote}
                      disabled={noteSaving || !noteDirty}
                      className="text-[11px] font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 px-2.5 py-1 rounded-md"
                    >
                      {noteSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  );
}
