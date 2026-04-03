/**
 * BarcodeScanner — full-screen camera scanner overlay with manual entry fallback.
 *
 * Uses html5-qrcode (dynamically imported) for camera-based barcode decoding.
 * Supports EAN-13, EAN-8, Code128, QR, and most common 1D/2D formats.
 *
 * CRITICAL IMPLEMENTATION NOTE:
 * Both camera and manual views are ALWAYS mounted in the DOM — visibility is
 * toggled via CSS (display:none). This prevents React crashes caused by
 * html5-qrcode injecting DOM nodes that React doesn't manage. Conditional
 * rendering (ternary) would cause React to unmount the camera container while
 * html5-qrcode's video/canvas elements are still attached, triggering a
 * "Failed to execute removeChild" error.
 */
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface BarcodeScannerProps {
  open: boolean;
  onScan: (barcode: string) => void;
  onClose: () => void;
  title?: string;
}

const READER_ID = 'krawings-barcode-reader';

export default function BarcodeScanner({ open, onScan, onClose, title = 'Scan barcode' }: BarcodeScannerProps) {
  const [manualEntry, setManualEntry] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const inputRef = useRef<HTMLInputElement>(null);

  // Safely wipe any DOM nodes html5-qrcode injected into the reader container
  const cleanReaderContainer = useCallback(() => {
    try {
      const el = document.getElementById(READER_ID);
      if (el) el.innerHTML = '';
    } catch (_e) { /* safe to ignore */ }
  }, []);

  // Focus manual input when switching to manual mode
  useEffect(() => {
    if (open && manualEntry) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open, manualEntry]);

  // Camera lifecycle — only active when overlay is open AND camera mode selected
  useEffect(() => {
    if (!open || manualEntry) {
      return;
    }

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;

    const start = async () => {
      try {
        // Clean any leftover DOM from previous scanner sessions
        cleanReaderContainer();

        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode(READER_ID);

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 280, height: 120 },
            disableFlip: false,
          },
          (decoded: string) => {
            try { navigator.vibrate(100); } catch (_e) { /* iOS */ }
            onScanRef.current(decoded);
          },
          () => { /* no barcode in frame — ignore */ }
        );

        if (!cancelled) {
          setScanning(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[BarcodeScanner] start failed:', msg);

        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera access denied. Tap your browser address bar lock icon to allow camera, then try again. Or use manual entry below.');
        } else if (msg.includes('NotFound') || msg.includes('device not found') || msg.includes('Requested device')) {
          setError('No camera found on this device. Use manual entry.');
        } else if (msg.includes('NotReadable') || msg.includes('Could not start')) {
          setError('Camera is in use by another app. Close other camera apps and try again.');
        } else {
          setError('Could not start camera. Use manual entry.');
        }
      }
    };

    const timer = setTimeout(start, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (scanner) {
        scanner.stop().catch(() => {});
        try { scanner.clear(); } catch (_e) { /* ok */ }
        scanner = null;
      }
      // Always clean orphaned DOM nodes to prevent React conflicts
      cleanReaderContainer();
      setScanning(false);
    };
  }, [open, manualEntry, cleanReaderContainer]);

  if (!open) return null;

  function handleManualSubmit() {
    const v = manualValue.trim();
    if (v.length >= 4) {
      onScan(v);
      setManualValue('');
    }
  }

  function handleClose() {
    setManualEntry(false);
    setManualValue('');
    setError(null);
    setScanning(false);
    onClose();
  }

  function switchToManual() {
    setError(null);
    setManualEntry(true);
  }

  function switchToCamera() {
    setError(null);
    setManualEntry(false);
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <button onClick={handleClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <span className="text-white text-[16px] font-semibold">{title}</span>
        <button onClick={() => manualEntry ? switchToCamera() : switchToManual()}
          className="px-3 py-1.5 rounded-full bg-white/10 text-white text-[13px] font-semibold active:bg-white/20">
          {manualEntry ? 'Camera' : 'Type'}
        </button>
      </div>

      {/*
        BOTH views are always in the DOM. We toggle with display:none.
        This prevents React crashes from html5-qrcode orphaned DOM nodes.
      */}

      {/* ── Manual barcode entry (always mounted) ── */}
      <div
        style={{ display: manualEntry ? 'flex' : 'none' }}
        className="flex-1 flex-col items-center justify-center px-6"
      >
        <div className="w-full max-w-sm">
          <label className="text-white/60 text-[13px] font-semibold mb-2 block">Enter barcode number</label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
            placeholder="e.g. 4006381333931"
            className="w-full px-4 py-4 rounded-xl bg-white/10 border border-white/20 text-white text-[18px] font-mono text-center placeholder:text-white/30 focus:outline-none focus:border-white/40"
          />
          <button onClick={handleManualSubmit}
            disabled={manualValue.trim().length < 4}
            className="w-full mt-4 py-4 rounded-xl bg-green-600 text-white text-[16px] font-bold active:bg-green-700 disabled:opacity-40">
            Look up
          </button>
        </div>
      </div>

      {/* ── Camera viewfinder (always mounted) ── */}
      <div
        style={{ display: manualEntry ? 'none' : 'flex' }}
        className="flex-1 flex-col items-center justify-center relative"
      >
        <div id={READER_ID} className="w-full max-w-[320px] aspect-square rounded-2xl overflow-hidden" />

        {error && (
          <div className="absolute bottom-24 left-6 right-6">
            <div className="bg-red-500/90 rounded-xl p-4 text-center">
              <p className="text-white text-[14px] font-semibold leading-snug">{error}</p>
              <button onClick={switchToManual}
                className="mt-3 w-full px-4 py-3 rounded-xl bg-white/20 text-white text-[14px] font-bold active:bg-white/30">
                Use manual entry
              </button>
            </div>
          </div>
        )}

        {scanning && !error && (
          <p className="text-white/50 text-[13px] mt-4">Point camera at barcode</p>
        )}
      </div>
    </div>
  );
}
