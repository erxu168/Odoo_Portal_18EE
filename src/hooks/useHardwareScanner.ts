/**
 * useHardwareScanner — detects Bluetooth/USB barcode scanner input.
 *
 * Hardware scanners act as keyboard devices: they fire rapid keydown events
 * (< 50ms between chars) ending with Enter. This hook buffers those chars
 * and fires onScan when the pattern matches.
 *
 * Ignores input when focus is on INPUT/TEXTAREA elements.
 */
'use client';

import { useEffect, useRef } from 'react';

interface UseHardwareScannerOptions {
  /** Whether the hook is active. Disable when modals are open. */
  enabled?: boolean;
  /** Called with the decoded barcode string. */
  onScan: (barcode: string) => void;
  /** Minimum barcode length to accept (default 4). */
  minLength?: number;
  /** Max ms between keystrokes to consider as scanner input (default 55). */
  maxGap?: number;
}

export function useHardwareScanner({
  enabled = true,
  onScan,
  minLength = 4,
  maxGap = 55,
}: UseHardwareScannerOptions) {
  // Use a ref so the effect doesn't re-run when onScan identity changes
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyTime = 0;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      // Skip if user is typing in a form field
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const now = Date.now();
      const gap = now - lastKeyTime;
      lastKeyTime = now;

      // Reset buffer if gap is too large (human typing)
      if (gap > maxGap && buffer.length > 0) {
        buffer = '';
      }

      if (clearTimer) clearTimeout(clearTimer);

      if (e.key === 'Enter') {
        if (buffer.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          onScanRef.current(buffer);
        }
        buffer = '';
        return;
      }

      // Only buffer single printable characters
      if (e.key.length === 1) {
        buffer += e.key;
      }

      // Auto-clear after inactivity
      clearTimer = setTimeout(() => { buffer = ''; }, 200);
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [enabled, minLength, maxGap]);
}
