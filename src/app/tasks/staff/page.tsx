'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TaskList, EmployeeContext } from '@/lib/odoo-tasks';
import ChecklistCard from '../_components/ChecklistCard';
import BottomNav from '../_components/BottomNav';

// Compress image to a max long-edge in pixels and JPEG at the given quality.
// Phone photos are 3-10 MB; this typically produces 100-300 KB which uploads
// reliably over JSON without hitting body-size or timeout limits.
async function compressImage(file: File, maxLongEdge: number, quality: number): Promise<{ base64: string; filename: string }> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result as string);
    reader.onerror = () => rej(new Error('File read error'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Image decode error'));
    i.src = dataUrl;
  });
  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = compressedDataUrl.split(',')[1] || '';
  // Replace original extension with .jpg since we re-encoded to JPEG
  const stem = file.name.replace(/\.[^/.]+$/, '') || 'photo';
  return { base64, filename: `${stem}.jpg` };
}

interface TodayResponse {
  context: EmployeeContext | null;
  list: TaskList | null;
  error?: string;
  code?: string;
}

export default function StaffPage() {
  const [data,    setData]    = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/today');
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Failed to load list');
        setData(body);  // keep context for empty-state messaging
      } else {
        setData(body);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleComplete(lineId: number) {
    const res = await fetch(`/api/tasks/lines/${lineId}/complete`, { method: 'POST' });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Failed to complete');
    await load();
  }

  async function handleSubtaskToggle(_lineId: number, subtaskId: number, done: boolean) {
    const res = await fetch(`/api/tasks/lines/${_lineId}/subtasks/${subtaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to toggle subtask');
    }
  }

  async function handlePhotoUpload(lineId: number) {
    // Browser file picker, base64 encode, upload
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment' as never;
    return new Promise<void>((resolve, reject) => {
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return reject(new Error('No file selected'));
        try {
          const compressed = await compressImage(file, 1280, 0.85);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);
          const res = await fetch(`/api/tasks/lines/${lineId}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: compressed.filename, data_base64: compressed.base64 }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
          const body = await res.json();
          if (!body.ok) return reject(new Error(body.error || 'Upload failed'));
          await load();
          resolve();
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'AbortError') {
            reject(new Error('Upload timed out — try again on a stronger connection'));
          } else {
            reject(e instanceof Error ? e : new Error('Upload failed'));
          }
        }
      };
      input.click();
    });
  }

  const today    = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const list = data?.list ?? null;
  const ctx  = data?.context ?? null;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 max-w-[430px] mx-auto">
      <div className="bg-orange-500 px-5 pt-5 pb-4 flex-shrink-0">
        <p className="text-orange-100 text-xs font-medium">{today}</p>
        <p className="text-white text-lg font-bold mt-0.5">{greeting} 👋</p>
        {ctx?.department_name && (
          <p className="text-orange-100 text-sm mt-0.5">{ctx.department_name}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <EmptyState
            emoji="⚠️"
            title={data?.code === 'NO_DEPARTMENT' ? 'No department' : data?.code === 'NO_EMPLOYEE' ? 'No employee record' : 'Could not load'}
            message={error}
          />
        ) : !list ? (
          <EmptyState
            emoji="📋"
            title="No task list for today"
            message={`No checklist has been published for ${ctx?.department_name ?? 'your department'} today. Ask your manager to create or spawn a list.`}
          />
        ) : list.lines.length === 0 ? (
          <EmptyState
            emoji="📝"
            title="Empty list"
            message="Today's list has no tasks yet."
          />
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Today&apos;s tasks</p>
              <p className="text-xs font-semibold text-gray-500">
                {list.completed_count} / {list.line_count} done · {list.completion_rate}%
              </p>
            </div>
            <ChecklistCard
              taskList={list}
              onComplete={handleComplete}
              onSubtaskToggle={handleSubtaskToggle}
              onPhotoUpload={handlePhotoUpload}
            />
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

function EmptyState({ emoji, title, message }: { emoji: string; title: string; message: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <p className="text-3xl mb-2">{emoji}</p>
      <p className="font-semibold text-gray-600">{title}</p>
      <p className="text-sm mt-1 max-w-xs mx-auto">{message}</p>
    </div>
  );
}
