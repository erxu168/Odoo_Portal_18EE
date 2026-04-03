'use client';

import { useState } from 'react';
import { TaskLine, SubTask } from '@/lib/odoo-tasks';
import SubtaskList from './SubtaskList';

interface Props {
  task: TaskLine;
  taskListId: number;
  onComplete: (taskId: number) => Promise<void>;
  onSubtaskToggle: (taskLineId: number, subtaskId: number, done: boolean) => Promise<void>;
  onPhotoUpload: (taskId: number) => Promise<void>;
}

const MODULE_STYLES: Record<string, string> = {
  purchase:      'bg-amber-50 text-amber-800 border-amber-200',
  inventory:     'bg-green-50  text-green-800  border-green-200',
  pos:           'bg-blue-50   text-blue-800   border-blue-200',
  manufacturing: 'bg-orange-50 text-orange-800 border-orange-200',
};
const MODULE_ICONS: Record<string, string> = {
  purchase: '🛒', inventory: '📦', pos: '🖥️', manufacturing: '🏭',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function TaskRow({ task, taskListId, onComplete, onSubtaskToggle, onPhotoUpload }: Props) {
  const [subtasks, setSubtasks]     = useState<SubTask[]>(task.subtasks);
  const [photoUploaded, setPhoto]   = useState(task.photo_uploaded);
  const [uploading, setUploading]   = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  if (task.state === 'done') return null;

  const allSubtasksDone = subtasks.length === 0 || subtasks.every(s => s.done);
  const isLocked        = subtasks.length > 0 && !allSubtasksDone;
  const needsPhoto      = task.photo_required && !photoUploaded;

  const overdueMinutes = task.state === 'overdue' && task.deadline_datetime
    ? Math.round((Date.now() - new Date(task.deadline_datetime).getTime()) / 60000)
    : 0;

  async function handleTap() {
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

  async function handlePhoto(e: React.MouseEvent) {
    e.stopPropagation();
    setUploading(true);
    try { await onPhotoUpload(task.id); setPhoto(true); setError(null); }
    catch { setError('Photo upload failed'); }
    finally { setUploading(false); }
  }

  return (
    <div onClick={handleTap}
      className={`flex items-start gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors cursor-pointer ${
        completing ? 'opacity-40 pointer-events-none' : 'hover:bg-orange-50/30'
      }`}>

      {/* Check circle */}
      <div className={`mt-0.5 w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center border-2 transition-all text-xs font-bold ${
        isLocked ? 'border-gray-200 bg-gray-50 text-gray-400' :
        task.state === 'overdue' ? 'border-red-400 bg-red-50 text-red-500' :
        'border-gray-300 bg-white'
      }`}>
        {isLocked ? '🔒' : task.state === 'overdue' ? '!' : ''}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm leading-snug ${task.state === 'overdue' ? 'text-red-700' : 'text-gray-800'}`}>
          {task.name}
        </p>

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

        {/* Subtask hint */}
        {subtasks.length > 0 && (
          <p className={`text-xs mt-1.5 font-medium ${
            allSubtasksDone ? 'text-green-600' : 'text-gray-400'
          }`}>
            {allSubtasksDone ? 'All subtasks done — tap to complete ✓' : `Complete ${subtasks.filter(s=>!s.done).length} more subtask${subtasks.filter(s=>!s.done).length > 1?'s':''} to unlock`}
          </p>
        )}

        <SubtaskList taskLineId={task.id} subtasks={subtasks} onToggle={handleSubtask} />

        {/* Module link */}
        {task.module_link_type && (
          <button onClick={e => { e.stopPropagation(); alert(`Opens: ${task.module_link_label}`); }}
            className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:shadow-sm ${MODULE_STYLES[task.module_link_type] ?? ''}`}>
            {MODULE_ICONS[task.module_link_type]} {task.module_link_label} ↗
          </button>
        )}

        {/* Photo upload */}
        {task.photo_required && !photoUploaded && allSubtasksDone && (
          <button onClick={handlePhoto} disabled={uploading}
            className="mt-2 w-full py-2.5 border-2 border-dashed border-orange-400 rounded-lg bg-orange-50 text-orange-700 text-xs font-semibold text-center hover:bg-orange-100 transition-colors disabled:opacity-60">
            {uploading ? '⏳ Uploading...' : '📸 Tap to take / upload photo'}
          </button>
        )}
        {photoUploaded && (
          <div className="mt-2 py-2 px-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-xs font-semibold">
            ✅ Photo uploaded — tap task to complete
          </div>
        )}

        {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  );
}
