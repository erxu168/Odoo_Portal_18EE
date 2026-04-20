'use client';

import React, { useEffect, useRef } from 'react';

interface ScannerSinkProps {
  onScan: (barcode: string) => void;
  enabled: boolean;
  minLength?: number;
  maxGap?: number;
}

/**
 * Focus-trap input that captures Bluetooth HID scanner keystrokes on
 * Android native WebView.
 *
 * Why this exists: Android WebView only dispatches physical keyboard
 * events to the DOM when a focusable input has focus. A window-level
 * `keydown` listener sees nothing otherwise. Desktop browsers don't
 * have this limitation.
 *
 * Approach: render a readOnly input (suppresses soft keyboard when
 * tapped), keep it focused by refocusing on every blur, and buffer
 * keystrokes until Enter to fire onScan.
 */
export default function ScannerSink({ onScan, enabled, minLength = 4, maxGap = 120 }: ScannerSinkProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Take focus on mount + keep taking it if enabled changes.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
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

    clearTimerRef.current = setTimeout(() => { bufferRef.current = ''; }, 300);
  }

  // Keep focus — whenever we lose it, grab it back on the next tick so
  // another focusable element has a chance to claim it if the user
  // actually tapped there. If nothing else wants focus, we reclaim.
  function handleBlur() {
    if (!enabled) return;
    setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) {
        inputRef.current?.focus({ preventScroll: true });
      }
    }, 0);
  }

  if (!enabled) return null;

  return (
    <input
      ref={inputRef}
      type="text"
      readOnly
      autoFocus
      aria-hidden="true"
      tabIndex={-1}
      inputMode="none"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'fixed',
        bottom: 0,
        right: 0,
        width: 1,
        height: 1,
        opacity: 0.01,
        border: 'none',
        outline: 'none',
        padding: 0,
        margin: 0,
        background: 'transparent',
        caretColor: 'transparent',
      }}
    />
  );
}
