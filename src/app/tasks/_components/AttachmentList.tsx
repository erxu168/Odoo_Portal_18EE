'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/ui/useConfirm';
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
  const [imgOpen, setImgOpen] = useState<TaskAttachment | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { confirm, confirmElement } = useConfirm();

  if (attachments.length === 0) return null;

  // Photos show as THUMBNAILS (like inventory counting); other files stay as rows.
  const images = attachments.filter(a => isImage(a.mimetype));
  const others = attachments.filter(a => !isImage(a.mimetype));

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
    if (!await confirm({
      title: `Delete "${att.name}"?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete file',
      variant: 'danger',
    })) return;
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
      {confirmElement}
      {/* Photos → thumbnail tiles (tap to enlarge), matching inventory counting. */}
      {images.length > 0 && (
        <div className={`flex flex-wrap gap-2 ${compact ? 'mt-1' : 'mt-2'}`}>
          {images.map(att => (
            <div key={att.id} className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
              <button
                type="button"
                onClick={() => setImgOpen(att)}
                className="w-full h-full block"
                aria-label={`View photo ${att.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/tasks/attachments/${att.id}`} alt={att.name} className="w-full h-full object-cover" loading="lazy" />
              </button>
              {att.scope === 'template' && (
                <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[8px] font-semibold text-center leading-tight py-0.5">template</span>
              )}
              {canDelete && att.scope !== 'template' && (
                <button
                  type="button"
                  onClick={() => deleteAttachment(att)}
                  disabled={deleting === att.id}
                  aria-label={`Remove photo ${att.name}`}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center active:bg-black disabled:opacity-50"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Non-image files (PDF / docs) stay as rows. */}
      {others.length > 0 && (
      <ul className={`${images.length > 0 ? 'mt-2' : compact ? '' : 'mt-2'} ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        {others.map(att => (
          <li
            key={att.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs"
          >
            <span className="flex-shrink-0">{isPdf(att.mimetype) ? '📄' : '📎'}</span>
            <button
              onClick={() => openAttachment(att)}
              disabled={loadingId === att.id}
              className="flex-1 min-w-0 text-left text-gray-800 hover:text-green-700 truncate disabled:opacity-50"
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
      )}

      {/* Photo lightbox — served straight from the bytes route. */}
      {imgOpen && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex flex-col" onClick={() => setImgOpen(null)}>
          <div className="flex justify-between items-center px-4 py-3 text-white">
            <span className="text-sm truncate">{imgOpen.name}</span>
            <button onClick={() => setImgOpen(null)} className="text-2xl px-3 -mr-3" aria-label="Close">×</button>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/tasks/attachments/${imgOpen.id}`} alt={imgOpen.name} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
          </div>
        </div>
      )}

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
              className="mt-4 block w-full text-center py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold"
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
