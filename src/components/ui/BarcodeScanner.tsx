/**
 * BarcodeScanner — full-screen camera scanner overlay with manual entry fallback.
 *
 * Uses html5-qrcode (dynamically imported) for camera-based barcode decoding.
 * Supports EAN-13, EAN-8, Code128, QR, and most common 1D/2D formats.
 *
 * Usage:
 *   <BarcodeScanner
 *     open={showScanner}
 *     onScan={(barcode) => handleScan(barcode)}
 *     onClose={() => setShowScanner(false)}
 *   />
 */
'use client';

import React, { useState, useEffect, useRef } from 'react';

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

  // Camera lifecycle
  useEffect(() => {
    if (!open || manualEntry) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let scanner: any = null;

    const start = async () => {
      try {
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
            try { navigator.vibrate(100); } catch (_e) { /* iOS has no vibrate */ }
            onScanRef.current(decoded);
          },
          () => { /* no barcode in frame */ }
        );

        if (!cancelled) {
          setScanning(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera permission denied. Allow access or use manual entry.');
        } else if (msg.includes('NotFound') || msg.includes('device not found')) {
          setError('No camera found. Use manual entry.');
        } else {
          setError('Could not start camera. Try manual entry.');
        }
        console.error('[BarcodeScanner]', err);
      }
    };

    const timer = setTimeout(start, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (scanner) {
        scanner.stop().catch(() => {});
        try { scanner.clear(); } catch (_e) { /* ok */ }
      }
      setScanning(false);
    };
  }, [open, manualEntry]);

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
    onClose();
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
        <button onClick={() => { setManualEntry(!manualEntry); setError(null); }}
          className="px-3 py-1.5 rounded-full bg-white/10 text-white text-[13px] font-semibold active:bg-white/20">
          {manualEntry ? 'Camera' : 'Type'}
        </button>
      </div>

      {manualEntry ? (
        /* ── Manual barcode entry ── */
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-sm">
            <label className="text-white/60 text-[13px] font-semibold mb-2 block">Enter barcode number</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
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
      ) : (
        /* ── Camera viewfinder ── */
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div id={READER_ID} className="w-full max-w-[320px] aspect-square rounded-2xl overflow-hidden" />

          {error && (
            <div className="absolute bottom-24 left-6 right-6">
              <div className="bg-red-500/90 rounded-xl p-3 text-center">
                <p className="text-white text-[14px] font-semibold">{error}</p>
                <button onClick={() => setManualEntry(true)}
                  className="mt-2 px-4 py-2 rounded-lg bg-white/20 text-white text-[13px] font-semibold active:bg-white/30">
                  Use manual entry
                </button>
              </div>
            </div>
          )}

          {scanning && !error && (
            <p className="text-white/50 text-[13px] mt-4">Point camera at barcode</p>
          )}
        </div>
      )}
    </div>
  );
}
