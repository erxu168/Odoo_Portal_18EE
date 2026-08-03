'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNumpad, type NumpadRequest } from './NumpadProvider';
import type { NumericValue } from '@/lib/numeric-input';

/**
 * useNumpadField — the shared numpad for screens that must keep their own markup.
 *
 * Spec: docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * ui/NumberField is the right answer for an ordinary form field. This hook is
 * for the places where the number is not rendered as an input at all — a big
 * tappable quantity on a counting row, a price inside a card, a cell in a table.
 * They get the same pad and the same rules without being forced into a text box.
 *
 * Returns `triggerProps` to spread onto whatever element should open the pad, so
 * the caller does not have to restate the accessibility bits each time.
 */
export interface UseNumpadFieldOptions extends Omit<NumpadRequest, 'initialValue'> {
  /** Current value; the pad opens on it. */
  value: NumericValue;
  disabled?: boolean;
}

export interface UseNumpadFieldResult {
  open: () => void;
  isOpen: boolean;
  /** Spread onto the element that opens the pad (a button, a row, a cell). */
  triggerProps: {
    onClick: () => void;
    role: 'button';
    tabIndex: number;
    'aria-haspopup': 'dialog';
    onKeyDown: (e: React.KeyboardEvent) => void;
  };
}

export function useNumpadField(options: UseNumpadFieldOptions): UseNumpadFieldResult {
  const numpad = useNumpad();

  // The caller rebuilds its options object every render; hold the latest in a
  // ref so `open` stays a stable callback while still using current labels and
  // callbacks when the pad actually opens.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const open = useCallback(() => {
    const { value, disabled, ...request } = optionsRef.current;
    if (!numpad || disabled) return;
    numpad.open({ ...request, initialValue: value });
  }, [numpad]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open],
  );

  return {
    open,
    isOpen: !!numpad?.isOpen,
    triggerProps: {
      onClick: open,
      role: 'button',
      tabIndex: options.disabled ? -1 : 0,
      'aria-haspopup': 'dialog',
      onKeyDown,
    },
  };
}

/**
 * True when this device should use the in-app pad rather than the OS keypad.
 * Capability, not user-agent — and resolved after mount so the server's HTML and
 * the client's first render agree.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setCoarse(window.matchMedia('(pointer: coarse)').matches);
    }
  }, []);
  return coarse;
}

export default useNumpadField;
