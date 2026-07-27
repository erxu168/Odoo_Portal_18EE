'use client';

/**
 * Makes anything accept a dragged-in file.
 *
 * A dashed upload box already looks like it should take a drop, so one that
 * does not reads as broken. This wraps whatever you already have — it renders
 * no chrome of its own — and adds the drop handling plus the state that tells
 * you it will accept.
 *
 * Two things it does that are easy to forget:
 *  - preventDefault on dragover AND drop. Without it the browser navigates away
 *    to the dropped image and whatever was on the screen is gone.
 *  - counts enter/leave. Dragging across a child element fires dragleave on the
 *    parent, so a naive boolean flickers the highlight off while the pointer is
 *    still inside.
 *
 * Dragging is always IN ADDITION to the existing ways in — never a replacement
 * for the camera, the camera roll or a file picker.
 */

import React, { useCallback, useRef, useState } from 'react';

export function DropZone({
  onFiles, accept = 'image/', multiple = false, disabled, className = '', children, hint,
}: {
  /** Called with the accepted files. Never called with an empty list. */
  onFiles: (files: File[]) => void;
  /** Mime prefix a file must match, e.g. "image/" or "application/pdf". */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Shown over the target while a file is being dragged across it. */
  hint?: string;
}) {
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const depth = useRef(0);

  const reset = () => { depth.current = 0; setOver(false); };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    reset();
    if (disabled) return;
    const all = Array.from(e.dataTransfer?.files || []);
    if (all.length === 0) return;
    const ok = all.filter((f) => f.type.startsWith(accept));
    if (ok.length === 0) {
      setRejected(accept.startsWith('image') ? 'That is not an image.' : 'That file type is not accepted here.');
      setTimeout(() => setRejected(null), 3000);
      return;
    }
    setRejected(null);
    onFiles(multiple ? ok : ok.slice(0, 1));
  }, [accept, multiple, onFiles, disabled]);

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(e) => { e.preventDefault(); depth.current -= 1; if (depth.current <= 0) reset(); }}
      onDrop={onDrop}
    >
      {children}

      {over && (
        <div className="absolute inset-0 z-10 rounded-2xl border-2 border-dashed border-green-600 bg-green-50/90 flex items-center justify-center pointer-events-none">
          <span className="text-[var(--fs-sm)] font-bold text-green-800">{hint || 'Drop it here'}</span>
        </div>
      )}

      {rejected && (
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-b-2xl bg-red-600 text-white text-[var(--fs-xs)] font-semibold px-3 py-1.5 text-center pointer-events-none">
          {rejected}
        </div>
      )}
    </div>
  );
}

export default DropZone;
