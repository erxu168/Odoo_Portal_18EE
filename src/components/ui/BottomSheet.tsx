'use client';

import React, { useEffect, useRef } from 'react';
import { CloseIcon } from './ChromeIcons';

// Module-level stack so Escape only closes the TOP-most sheet — otherwise a
// stacked sheet's Escape would also fire the underlying sheet's onClose and
// discard its edits.
const sheetStack: symbol[] = [];

/**
 * Portal-standard bottom sheet (modal dialog that slides up from the bottom).
 *
 * Part of the design standard (docs/superpowers/specs/2026-07-21-portal-design-standard-design.md).
 * Promoted to ui/ in wave 0 from shift-handover/common.tsx so every module shares
 * one sheet instead of hand-rolling `rounded-t-2xl` overlays.
 *
 * Anatomy: dimmed backdrop (tap-outside closes) + white panel with a title + close
 * header, a scrollable body, and an optional footer padded for the iOS safe area.
 * z-[100] so it always sits above the bottom nav / app chrome.
 *
 * Deliberately does NOT trap focus or lock body scroll: several sheets host camera
 * and file inputs that break under those behaviours on iOS WebView. Escape and
 * backdrop dismissal are provided; the caller conditionally mounts the sheet.
 */
export interface BottomSheetProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
}

export function BottomSheet({
  title,
  onClose,
  children,
  footer,
  closeLabel = 'Close',
  dismissOnBackdrop = true,
}: BottomSheetProps) {
  // Keep onClose current without re-running the mount effect (callers usually
  // pass a fresh arrow each render, which would otherwise churn the stack).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = Symbol('sheet');
    sheetStack.push(id);
    function onKey(e: KeyboardEvent) {
      // Only the top-most sheet responds, so a stacked sheet's Escape can't
      // close (and discard edits in) the sheet beneath it.
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === id) {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const idx = sheetStack.lastIndexOf(id);
      if (idx !== -1) sheetStack.splice(idx, 1);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        className="bg-white w-full max-w-lg mx-auto rounded-t-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <h2 className="text-[var(--fs-lg)] font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 active:text-gray-600 w-9 h-9 flex items-center justify-center"
            aria-label={closeLabel}
          >
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-gray-100 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

export default BottomSheet;
