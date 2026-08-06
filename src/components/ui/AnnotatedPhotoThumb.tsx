'use client';

/**
 * A small photo you can tap to see properly, with the author's marks on it.
 *
 * Wherever an annotated photo hangs off something in a list — a subtask, a
 * checklist item — the list has to stay scannable, so the photo is a thumbnail
 * and the real thing opens over it. This owns both halves so no screen has to
 * rebuild the pair, and so they can't drift.
 *
 * It also owns what happens when the photo does NOT load. An <img> pointed at a
 * 404 shows the browser's broken-image icon, which reads as "this app is
 * broken" — that is exactly the bug that prompted this component. A photo that
 * cannot be fetched says so quietly instead.
 *
 * The enlarged view goes through a PORTAL, and that is not a styling choice.
 * These thumbnails sit inside rows that complete a task or tick a subtask off
 * when you tap them. Rendered in place, the full-screen backdrop is a DOM child
 * of that row, so closing the picture bubbled up and marked the work done —
 * real completion data written because someone looked at a photo. A portal puts
 * the overlay outside the row entirely; the stopPropagation below is the second
 * lock on the same door.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import PinnableImage from './PinnableImage';
import { parseDrawings, type GuideDrawing } from '@/lib/guide-drawings';
import { useEscapeStack } from '@/lib/modal-stack';

interface Props {
  /** Route the bytes come from. Null renders nothing at all. */
  src: string | null;
  /** Marks over the photo — the serialised string straight off the record, or
   *  already-parsed shapes. */
  drawings: string | GuideDrawing[] | null | undefined;
  /** What the photo is OF, e.g. the subtask name. Used for the labels. */
  label: string;
  /** Thumbnail edge in px. 44 keeps a tap target legal on its own; 28 is for a
   *  dense read-only list where the row itself is the tap target. */
  size?: number;
  className?: string;
}

export default function AnnotatedPhotoThumb({ src, drawings, label, size = 44, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // Portals need a document, which the server render does not have.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEscapeStack(() => setOpen(false), open);

  if (!src) return null;

  const shapes = typeof drawings === 'string' ? parseDrawings(drawings) : (drawings || []);

  if (failed) {
    return (
      <span
        title="Photo could not be loaded"
        aria-label={`Photo for ${label} could not be loaded`}
        style={{ width: size, height: size }}
        className={`flex-shrink-0 inline-flex items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400 text-[var(--fs-xs)] ${className}`}
      >
        <span aria-hidden="true">📷</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        aria-label={`Show the photo for ${label}`}
        style={{ width: size, height: size }}
        className={`flex-shrink-0 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 active:scale-[0.97] transition-transform ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      </button>

      {open && mounted && createPortal((
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          // Every one of these stops the click here. The row underneath treats a
          // tap as "this is done" — see the note at the top of the file.
          onClick={e => { e.stopPropagation(); setOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo for ${label}`}
        >
          <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-white font-semibold text-[var(--fs-sm)] min-w-0 truncate">{label}</p>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setOpen(false); }}
                aria-label="Close"
                className="w-11 h-11 flex-shrink-0 rounded-full bg-white/15 text-white flex items-center justify-center active:bg-white/25"
              >
                <span aria-hidden="true" className="text-[var(--fs-lg)] leading-none">✕</span>
              </button>
            </div>
            <div className="flex justify-center">
              {/* The same component the guides use, in view mode: the marks are
                  an overlay in fractional coordinates, so they land correctly at
                  whatever size this dialog gives the photo. */}
              <PinnableImage
                src={src}
                alt={`Photo for ${label}`}
                mode="view"
                pins={[]}
                drawings={shapes}
                onImageError={() => { setFailed(true); setOpen(false); }}
                imgClassName="max-h-[75vh] rounded-xl"
              />
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
