'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { TaskAttachment } from '@/lib/odoo-tasks';

const PdfViewer = dynamic(() => import('@/components/ui/PdfViewer'), { ssr: false });

interface Props {
  attachments: TaskAttachment[];
  /** When true, show inline Delete buttons (manager view). */
  canDelete?: boolean;
  /** Called after a delete completes so the parent can reload. */
  onDeleted?: (attachmentId: number) => void;
  /** Compact = smaller styling for embedded use (template editor list). */
  compact?: boolean;
}

interface OpenAttachment {
  id: number;
  name: string;
  mimetype: string;
  data_base64: string;
}

function isImage(mime: string) {
  return mime.startsWith('image/');
}
function isPdf(mime: string) {
  return mime === 'application/pdf' || mime.endsWith('/pdf');
}

export default function AttachmentList({ attachments, canDelete = false, onDeleted, compact = false }: Props) {
  const [open, setOpen] = useState<OpenAttachment | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  async function openAttachment(att: TaskAttachment) {
    setLoadingId(att.id);
    try {
      const res = await fetch(`/api/tasks/attachments/${att.id}/data`);
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed to load');
      setOpen({ id: att.id, name: body.name, mimetype: body.mimetype, data_base64: body.data_base64 });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not open file');
    } finally {
      setLoadingId(null);
    }
  }

  async function deleteAttachment(att: TaskAttachment) {
    if (!confirm(`Delete "${att.name}"? This cannot be undone.`)) return;
    setDeleting(att.id);
    try {
      const res = await fetch(`/api/tasks/attachments/${att.id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed to delete');
      onDeleted?.(att.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <ul className={compact ? 'space-y-1' : 'space-y-1.5 mt-2'}>
        {attachments.map(att => (
          <li
            key={att.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs"
          >
            <span className="flex-shrink-0">{isPdf(att.mimetype) ? '📄' : isImage(att.mimetype) ? '🖼️' : '📎'}</span>
            <button
              onClick={() => openAttachment(att)}
              disabled={loadingId === att.id}
              className="flex-1 min-w-0 text-left text-gray-800 hover:text-orange-600 truncate disabled:opacity-50"
            >
              {loadingId === att.id ? 'Loading…' : att.name}
            </button>
            {att.scope === 'template' && (
              <span className="text-[10px] text-gray-400 flex-shrink-0">from template</span>
            )}
            {canDelete && att.scope !== 'template' && (
              <button
                onClick={() => deleteAttachment(att)}
                disabled={deleting === att.id}
                className="text-[11px] text-red-500 hover:text-red-600 flex-shrink-0 disabled:opacity-50"
              >
                {deleting === att.id ? '…' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {open && isPdf(open.mimetype) && (
        <PdfViewer
          fileData={open.data_base64}
          fileName={open.name}
          onClose={() => setOpen(null)}
        />
      )}
      {open && isImage(open.mimetype) && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex flex-col" onClick={() => setOpen(null)}>
          <div className="flex justify-between items-center px-4 py-3 text-white">
            <span className="text-sm truncate">{open.name}</span>
            <button onClick={() => setOpen(null)} className="text-2xl px-3 -mr-3">×</button>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-2">
            <img
              src={`data:${open.mimetype};base64,${open.data_base64}`}
              alt={open.name}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}
      {open && !isPdf(open.mimetype) && !isImage(open.mimetype) && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-6" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="font-semibold text-gray-800">{open.name}</p>
            <p className="text-sm text-gray-500 mt-2">This file type ({open.mimetype || 'unknown'}) can&apos;t be previewed in the app. Tap below to download.</p>
            <a
              href={`data:${open.mimetype || 'application/octet-stream'};base64,${open.data_base64}`}
              download={open.name}
              className="mt-4 block w-full text-center py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold"
            >
              Download
            </a>
            <button onClick={() => setOpen(null)} className="mt-2 w-full py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600">Close</button>
          </div>
        </div>
      )}
    </>
  );
}
