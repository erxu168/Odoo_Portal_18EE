'use client';

import { useEffect, useRef } from 'react';

/**
 * modal-stack — who owns the Escape key right now.
 *
 * Every overlay (bottom sheet, numpad, dialog) registers here while it is open.
 * Only the TOP-most one reacts to Escape. Without this, an overlay opened on top
 * of a sheet closes both: each listens on `document` independently, and
 * stopPropagation does nothing about other listeners on the same node — so one
 * Escape would cancel the numpad AND discard the sheet's half-typed edits
 * underneath it.
 *
 * Extracted from ui/BottomSheet's private `sheetStack` so ui/NumpadProvider can
 * share the same ordering rather than starting a rival stack.
 */

const stack: symbol[] = [];

/** Register an overlay for as long as it is mounted, and run `onEscape` only while it is top-most. */
export function useEscapeStack(onEscape: () => void, enabled = true): void {
  // Keep the callback current without re-running the effect — callers pass a
  // fresh arrow each render, which would otherwise churn the stack order.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;

    const id = Symbol('overlay');
    stack.push(id);

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (stack[stack.length - 1] !== id) return;
      e.stopPropagation();
      onEscapeRef.current();
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const idx = stack.lastIndexOf(id);
      if (idx !== -1) stack.splice(idx, 1);
    };
  }, [enabled]);
}

/** How many overlays are open. Exposed for tests and for debugging stuck backdrops. */
export function openOverlayCount(): number {
  return stack.length;
}
