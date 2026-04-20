'use client';

import React, { useEffect, useRef } from 'react';

interface ScannerSinkProps {
  onScan: (barcode: string) => void;
  enabled: boolean;
  minLength?: number;
  maxGap?: number;
}

/**
 * Hidden focusable input that captures Bluetooth HID scanner keystrokes
 * on Android native WebView.
 *
 * Why this exists: Android WebView does not forward physical keyboard
 * events to the DOM unless an input element has focus. A window-level
 * `keydown` listener (our useHardwareScanner hook) sees nothing until a
 * visible input is tapped. Desktop browsers dispatch window-level events
 * just fine, so the hook alone was enough there.
 *
 * Placement: render once per screen where scanning is allowed. The input
 * stays focused whenever no other input or button has focus — pointer
 * taps on buttons/lists fall through to the body, and we refocus here.
 *
 * User-visible input (search, numpad) steals focus normally; while they
 * are focused, this sink is dormant, so typing into the search box still
 * works.
 */
export default function ScannerSink({ onScan, enabled, minLength = 4, maxGap = 120 }: ScannerSinkProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refocus the sink whenever nothing else is focused (after a tap on a
  // non-input element, the active element becomes document.body — we
  // reclaim focus so the next scan is captured).
  useEffect(() => {
    if (!enabled) return;

    function ensureFocus() {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) {
        inputRef.current?.focus();
      }
    }

    // Initial focus
    const initialTimer = setTimeout(ensureFocus, 50);

    // Refocus whenever the window regains focus
    window.addEventListener('focus', ensureFocus);
    // Refocus after taps — pointer events land before click handlers run
    document.addEventListener('pointerup', ensureFocus);

    return () => {
      clearTimeout(initialTimer);
      window.removeEventListener('focus', ensureFocus);
      document.removeEventListener('pointerup', ensureFocus);
    };
  }, [enabled]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    if (gap > maxGap && bufferRef.current.length > 0) {
      bufferRef.current = '';
    }

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);

    if (e.key === 'Enter') {
      e.preventDefault();
      const code = bufferRef.current;
      bufferRef.current = '';
      if (code.length >= minLength) {
        onScan(code);
      }
      return;
    }

    if (e.key.length === 1) {
      bufferRef.current += e.key;
    }

    clearTimerRef.current = setTimeout(() => { bufferRef.current = ''; }, 250);
  }

  // Keep the underlying <input> value empty so nothing accumulates.
  function handleInput(e: React.FormEvent<HTMLInputElement>) {
    (e.target as HTMLInputElement).value = '';
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="none"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      aria-hidden="true"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        opacity: 0,
        width: 1,
        height: 1,
        pointerEvents: 'none',
        border: 'none',
        outline: 'none',
        caretColor: 'transparent',
        zIndex: -1,
      }}
    />
  );
}
