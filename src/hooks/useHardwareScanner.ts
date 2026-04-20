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
  /** Max ms between keystrokes to consider as scanner input (default 120).
   *  Bluetooth HID scanners are slower than USB — USB is often 5-15ms per
   *  char, BT typically 30-80ms and spikes higher on Android. 120ms gives
   *  us margin without catching human typing (150ms+). */
  maxGap?: number;
}

export function useHardwareScanner({
  enabled = true,
  onScan,
  minLength = 4,
  maxGap = 120,
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

    // Native Android bridge path: MainActivity.dispatchKeyEvent() captures
    // HID scanner input before the WebView swallows it and dispatches a
    // CustomEvent('nativeHidScan', { detail: { barcode } }) on Enter.
    // This bypasses Android WebView's focus requirement entirely.
    function handleNativeScan(e: Event) {
      const detail = (e as CustomEvent).detail || {};
      const barcode: string = detail.barcode;
      if (typeof barcode === 'string' && barcode.length >= minLength) {
        onScanRef.current(barcode);
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('nativeHidScan', handleNativeScan as EventListener);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('nativeHidScan', handleNativeScan as EventListener);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [enabled, minLength, maxGap]);
}
