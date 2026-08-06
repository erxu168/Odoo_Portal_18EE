'use client';

/**
 * A subtask's own reference photo, with the manager's marks over it.
 *
 * "Wipe the slicer" means nothing to someone who has never seen the slicer.
 * A photo with a red circle round the part that matters does — so a subtask
 * gets the same annotated photo a guide step has, using the same components
 * and the same stored shape (fractions 0..1, drawings as JSON), not a second
 * implementation that would drift.
 *
 * Marks only — no numbered note-pins. A subtask already HAS its name; a pin
 * would be a second label competing with it.
 *
 * The photo is edited in a collapsed panel: a manager adding six subtasks
 * should not scroll past six photo editors to reach the next name field.
 */
import { useState } from 'react';
import PinnableImage from '@/components/ui/PinnableImage';
import DrawingToolbar, { useDrawingTools } from '@/components/ui/DrawingToolbar';
import PhotoSourceSheet from '@/components/ui/PhotoSourceSheet';
import { DropZone } from '@/components/ui/DropZone';
import { useConfirm } from '@/components/ui/useConfirm';
import { compressImage } from './photoUpload';
import type { GuideDrawing } from '@/lib/guide-drawings';

interface Props {
  /** What to show: a server route for a stored photo, a data: URL for a pending
   *  upload, or null when there is none. */
  photoUrl: string | null;
  drawings: GuideDrawing[];
  /** Name of the subtask — used for the alt text, so it says something real. */
  label: string;
  disabled?: boolean;
  /** A new or replacement photo, already compressed. dataUrl is for previewing
   *  it before the save round trip. */
  onPick: (v: { base64: string; filename: string; dataUrl: string }) => void;
  onClear: () => void;
  onDrawings: (shapes: GuideDrawing[]) => void;
  /** Kept in step with the parent's save guard, so a save can't start while a
   *  photo is still being compressed and silently drop it. */
  onBusyChange?: (busy: boolean) => void;
}

export default function SubtaskPhotoField({
  photoUrl, drawings, label, disabled = false, onPick, onClear, onDrawings, onBusyChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const { confirm, confirmElement } = useConfirm();
  const tools = useDrawingTools({ shapes: drawings, onChange: onDrawings });

  /** ONE path in for the picker AND a drop, so a dropped replacement hits the
   *  same "your marks will go" confirmation a picked one does. */
  async function accept(file: File | null | undefined) {
    if (!file || disabled) return;
    if (photoUrl && drawings.length > 0 && !await confirm({
      title: 'Replace this photo?',
      message: 'The marks drawn on it are removed, because they point at the old photo.',
      confirmLabel: 'Replace photo',
      variant: 'danger',
    })) return;
    setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const { base64, filename } = await compressImage(file, 1280, 0.85);
      setImgError(false);
      onPick({ base64, filename, dataUrl: `data:image/jpeg;base64,${base64}` });
      setOpen(true);
    } catch {
      setError('Could not read that photo — try a JPEG or PNG.');
    } finally {
      setBusy(false); onBusyChange?.(false);
    }
  }

  async function remove() {
    if (!await confirm({
      title: 'Remove this photo?',
      message: 'The photo and any marks on it go. The subtask itself stays.',
      confirmLabel: 'Remove photo',
      variant: 'danger',
    })) return;
    onClear();
    setOpen(false);
    setImgError(false);
  }

  return (
    <div className="mt-1">
      {confirmElement}
      {chooser && (
        <PhotoSourceSheet
          title="Subtask photo"
          disabled={disabled}
          onFile={(f: File) => void accept(f)}
          onClose={() => setChooser(false)}
        />
      )}

      <DropZone onFiles={fs => void accept(fs[0])} disabled={disabled} hint={photoUrl ? 'Drop to replace' : 'Drop the photo here'}>
        <div className="flex items-center gap-2">
          {photoUrl && !imgError ? (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              aria-expanded={open}
              className="flex items-center gap-2 min-h-[44px] pr-2 rounded-lg text-[var(--fs-xs)] font-semibold text-gray-700 hover:bg-gray-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt=""
                onError={() => setImgError(true)}
                className="w-10 h-10 rounded-lg border border-gray-200 object-cover"
              />
              {open ? 'Hide photo' : 'Photo · edit marks'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setChooser(true)}
              disabled={disabled || busy}
              className="min-h-[44px] flex items-center gap-1 px-1 text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 disabled:opacity-50"
            >
              <span aria-hidden="true">📷</span>
              {busy ? 'Processing…' : imgError ? 'Choose a new photo' : 'Add a photo'}
            </button>
          )}
        </div>
      </DropZone>

      {imgError && photoUrl && (
        <p className="text-[var(--fs-xs)] text-red-600 mt-1">Couldn&apos;t load this photo. Choose another one.</p>
      )}
      {error && <p className="text-[var(--fs-xs)] text-red-600 mt-1">{error}</p>}

      {open && photoUrl && !imgError && (
        <div className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-white p-2">
          <div className="flex justify-center bg-gray-50 rounded-lg p-1">
            <PinnableImage
              src={photoUrl}
              alt={label ? `Photo for ${label}` : 'Subtask photo'}
              mode="edit"
              disabled={disabled}
              pins={[]}
              onImageError={() => setImgError(true)}
              drawings={drawings}
              drawTool={tools.tool}
              drawColor={tools.color}
              drawWidth={tools.width}
              onDrawAdd={tools.add}
              drawSelected={tools.selected}
              onDrawSelect={tools.setSelected}
              onDrawUpdate={tools.update}
              imgClassName="max-h-[50vh]"
            />
          </div>
          <DrawingToolbar tools={tools} disabled={disabled} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--fs-xs)] text-gray-500">
              {drawings.length} mark{drawings.length === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => setChooser(true)}
                disabled={disabled || busy}
                className="min-h-[44px] flex items-center text-[var(--fs-xs)] font-semibold text-green-700 hover:text-green-800 disabled:opacity-50"
              >
                {busy ? 'Processing…' : 'Replace photo'}
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={disabled}
                className="min-h-[44px] flex items-center text-[var(--fs-xs)] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                Remove photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
