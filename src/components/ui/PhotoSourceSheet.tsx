'use client';

import React from 'react';
import BottomSheet from '@/components/ui/BottomSheet';
import PhotoSourceButtons from '@/components/ui/PhotoSourceButtons';

/**
 * PhotoSourceSheet — THE standard way a photo field asks "where from?".
 *
 * Camera · Photos · Files (+ drag inside the sheet), in a bottom sheet, so a
 * screen keeps its own trigger button and styling and still offers every way
 * in. Use this wherever a bare `<input accept="image/*">` used to be: that
 * input delegates the choice to the OS sheet, and on the kitchen Android
 * tablets that sheet lists the GALLERY ONLY — staff on a photo-required count
 * could not take the photo (found live 2026-08-03).
 *
 * Skill: `.claude/skills/photo-inputs`.
 */
interface Props {
  onFile: (file: File) => void;
  /** Always fired to close the sheet — after a pick AND on dismissal. */
  onClose: () => void;
  /**
   * Fired ONLY when the user closed without choosing. Callers holding a
   * pending promise must reject HERE, never in onClose — a successful pick
   * closes the sheet too, and treating that as a cancel loses the upload.
   */
  onDismiss?: () => void;
  /** Rear for shelves/deliveries/proof (default); front only for faces. */
  facing?: 'environment' | 'user';
  title?: string;
  disabled?: boolean;
}

export default function PhotoSourceSheet({ onFile, onClose, onDismiss, facing = 'environment', title = 'Add a photo', disabled }: Props) {
  const picked = React.useRef(false);
  return (
    <BottomSheet title={title} onClose={() => { if (!picked.current) onDismiss?.(); onClose(); }}>
      <PhotoSourceButtons
        facing={facing}
        disabled={disabled}
        onFile={(f) => { picked.current = true; onClose(); onFile(f); }}
      />
      <p className="text-[var(--fs-xs)] text-gray-400 mt-3">
        You can also drag a photo straight onto the field.
      </p>
    </BottomSheet>
  );
}
