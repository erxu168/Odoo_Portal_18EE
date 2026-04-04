'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ───── Types ───── */

type ScanResult =
  | { kind: 'scanning' }
  | { kind: 'found'; product: any; }
  | { kind: 'looking_up'; barcode: string }
  | { kind: 'not_in_list'; barcode: string; productName: string }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'manual' };

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  /** Products loaded for this session/quick-count */
  products: any[];
  /** Current count entries: product_id → counted_qty */
  entries: Record<number, number>;
  totalCount: number;
  countedCount: number;
  /** Called when user confirms a count from the scanner */
  onCount: (productId: number, qty: number, uom: string) => void;
  userRole: string;
  title?: string;
}

const READER_ID = 'krawings-barcode-reader';

export default function BarcodeScanner({
  open, onClose, products, entries, totalCount, countedCount,
  onCount, userRole, title = 'Scan product',
}: BarcodeScannerProps) {
  const [scanResult, setScanResult] = useState<ScanResult>({ kind: 'scanning' });
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'warning' } | null>(null);
  const [manualValue, setManualValue] = useState('');

  const scannerRef = useRef<any>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // Refs to avoid stale closures in scanner callback
  const productsRef = useRef(products);
  productsRef.current = products;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /* ───── Helpers ───── */

  const showToast = useCallback((msg: string, type: 'success' | 'warning' = 'success') => {
    setToast({ msg, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const cleanContainer = useCallback(() => {
    try {
      const el = document.getElementById(READER_ID);
      if (el) el.innerHTML = '';
    } catch (_e) { /* ignore */ }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch (_e) { /* ignore */ }
      try { scannerRef.current.clear(); } catch (_e) { /* ignore */ }
      scannerRef.current = null;
    }
    cleanContainer();
    setCameraReady(false);
  }, [cleanContainer]);

  const pauseScanner = useCallback(() => {
    if (scannerRef.current) {
      try { scannerRef.current.pause(false); } catch (_e) { /* ignore */ }
    }
  }, []);

  const resumeScanner = useCallback(() => {
    if (scannerRef.current) {
      try { scannerRef.current.resume(); } catch (_e) { /* ignore */ }
    }
    setScanResult({ kind: 'scanning' });
  }, []);

  /* ───── Barcode processing ───── */

  const processBarcode = useCallback(async (barcode: string) => {
    const prods = productsRef.current;
    const ents = entriesRef.current;

    // 1. Check local products (by barcode field)
    const product = prods.find((p: any) => p.barcode && p.barcode === barcode);
    if (product) {
      const currentQty = ents[product.id];
      const defaultQty = currentQty !== undefined ? currentQty + 1 : 1;
      setQty(defaultQty);
      setScanResult({ kind: 'found', product });
      pauseScanner();
      try { navigator.vibrate(100); } catch (_e) { /* ignore */ }
      return;
    }

    // 2. Not in local products — look up in Odoo
    setScanResult({ kind: 'looking_up', barcode });
    pauseScanner();
    try { navigator.vibrate(100); } catch (_e) { /* ignore */ }

    try {
      const res = await fetch(`/api/inventory/barcode-lookup?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (data.found && data.product) {
        setScanResult({ kind: 'not_in_list', barcode, productName: data.product.name });
      } else {
        setScanResult({ kind: 'unknown', barcode });
      }
    } catch (_err) {
      setScanResult({ kind: 'unknown', barcode });
    }
  }, [pauseScanner]);

  // Stable ref for the scanner callback
  const processBarcodeRef = useRef(processBarcode);
  processBarcodeRef.current = processBarcode;

  /* ───── Camera lifecycle ───── */

  const isManual = scanResult.kind === 'manual';
  const wantCamera = open && !isManual;

  useEffect(() => {
    if (!wantCamera) {
      stopScanner();
      return;
    }

    // Don't restart if scanner is already running (just paused between scans)
    if (scannerRef.current) return;

    let cancelled = false;

    const start = async () => {
      cleanContainer();
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        const s = new Html5Qrcode(READER_ID);
        scannerRef.current = s;

        await s.start(
          { facingMode: { exact: 'environment' } },
          {
            fps: 15,
            qrbox: { width: 300, height: 150 },
            disableFlip: false,
            ...(({ experimentalFeatures: { useBarCodeDetectorIfSupported: true } }) as any),
          },
          (decoded: string) => {
            processBarcodeRef.current(decoded);
          },
          () => { /* ignore failed decode attempts */ },
        );

        // Request continuous autofocus + higher resolution
        if (!cancelled) {
          try {
            const videoEl = document.querySelector('#' + READER_ID + ' video') as HTMLVideoElement | null;
            const track = videoEl?.srcObject instanceof MediaStream
              ? videoEl.srcObject.getVideoTracks()[0]
              : null;
            if (track) {
              const caps = track.getCapabilities?.() as any;
              const advConstraints: any[] = [];
              if (caps?.focusMode?.includes('continuous')) {
                advConstraints.push({ focusMode: 'continuous' });
              }
              if (caps?.zoom) {
                // slight zoom helps barcode readability
                advConstraints.push({ zoom: Math.min(caps.zoom.max, 2.0) });
              }
              if (advConstraints.length > 0) {
                await track.applyConstraints({
                  advanced: advConstraints,
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                } as any);
              }
            }
          } catch (_focusErr) {
            console.debug('[BarcodeScanner] autofocus setup skipped');
          }
          setCameraReady(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[BarcodeScanner]', msg);
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera access denied. Go to Android Settings \u2192 Apps \u2192 Krawings Portal \u2192 Permissions \u2192 enable Camera, then reopen the scanner.');
        } else if (msg.includes('NotFound') || msg.includes('device not found') || msg.includes('Requested device')) {
          setError('No camera found. Use manual entry.');
        } else if (msg.includes('NotReadable') || msg.includes('Could not start')) {
          setError('Camera in use by another app. Close it and retry.');
        } else {
          setError('Camera error. Try manual entry.');
        }
      }
    };

    const timer = setTimeout(start, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCamera]);

  // Focus manual input when switching to manual mode
  useEffect(() => {
    if (open && isManual) {
      const t = setTimeout(() => manualInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open, isManual]);

  /* ───── Actions ───── */

  function handleConfirmCount() {
    if (scanResult.kind !== 'found') return;
    const { product } = scanResult;
    const uom = product.uom_id?.[1] || 'Units';
    onCount(product.id, qty, uom);
    showToast(`${product.name} \u2192 ${qty} ${uom}`);
    resumeScanner();
  }

  function handleDismissResult() {
    resumeScanner();
  }

  function handleManualSubmit() {
    const v = manualValue.trim();
    if (v.length >= 4) {
      processBarcode(v);
      setManualValue('');
    }
  }

  function handleClose() {
    stopScanner();
    setScanResult({ kind: 'scanning' });
    setManualValue('');
    setError(null);
    setToast(null);
    onClose();
  }

  function toggleManual() {
    setError(null);
    if (isManual) {
      setScanResult({ kind: 'scanning' });
    } else {
      setScanResult({ kind: 'manual' });
    }
  }

  /* ───── Render ───── */

  const hasResult = scanResult.kind === 'found' || scanResult.kind === 'not_in_list'
    || scanResult.kind === 'unknown' || scanResult.kind === 'looking_up';

  return (
    <div
      style={{ display: open ? 'flex' : 'none' }}
      className="fixed inset-0 z-[70] bg-black flex-col"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <button onClick={handleClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <span className="text-white text-[16px] font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <span className={`text-[13px] font-bold px-2.5 py-1 rounded-full ${
              countedCount === totalCount
                ? 'bg-green-500/20 text-green-400'
                : 'bg-white/10 text-white/70'
            }`}>
              {countedCount}/{totalCount}
            </span>
          )}
          <button onClick={toggleManual}
            className="px-3 py-1.5 rounded-full bg-white/10 text-white text-[13px] font-semibold active:bg-white/20">
            {isManual ? 'Camera' : 'Type'}
          </button>
        </div>
      </div>

      {/* ── Camera view ── */}
      <div
        style={{ display: isManual ? 'none' : 'flex' }}
        className="flex-1 flex-col items-center justify-center relative"
      >
        <div id={READER_ID} className="w-full max-w-[320px] aspect-square rounded-2xl overflow-hidden" />

        {cameraReady && !hasResult && !error && (
          <p className="text-white/50 text-[13px] mt-4">Point camera at barcode</p>
        )}

        {error && (
          <div className="absolute bottom-24 left-6 right-6">
            <div className="bg-red-500/90 rounded-xl p-4 text-center">
              <p className="text-white text-[14px] font-semibold leading-snug">{error}</p>
              <button onClick={toggleManual}
                className="mt-3 w-full px-4 py-3 rounded-xl bg-white/20 text-white text-[14px] font-bold active:bg-white/30">
                Use manual entry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Manual entry view ── */}
      <div
        style={{ display: isManual ? 'flex' : 'none' }}
        className="flex-1 flex-col items-center justify-center px-6"
      >
        <div className="w-full max-w-sm">
          <label className="text-white/60 text-[13px] font-semibold mb-2 block">Enter barcode number</label>
          <input
            ref={manualInputRef}
            type="text"
            inputMode="numeric"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
            placeholder="e.g. 2000001000003"
            className="w-full px-4 py-4 rounded-xl bg-white/10 border border-white/20 text-white text-[18px] font-mono text-center placeholder:text-white/30 focus:outline-none focus:border-white/40"
          />
          <button onClick={handleManualSubmit} disabled={manualValue.trim().length < 4}
            className="w-full mt-4 py-4 rounded-xl bg-green-600 text-white text-[16px] font-bold active:bg-green-700 disabled:opacity-40">
            Look up
          </button>
        </div>
      </div>

      {/* ── Toast (shows briefly after confirm) ── */}
      {toast && (
        <div className={`absolute top-28 left-4 right-4 px-4 py-3 rounded-xl flex items-center gap-2 z-[72] ${
          toast.type === 'success' ? 'bg-green-600/95' : 'bg-amber-500/95'
        }`}>
          {toast.type === 'success' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          )}
          <span className="text-white text-[14px] font-semibold truncate">{toast.msg}</span>
        </div>
      )}

      {/* ── Product found — qty input + confirm ── */}
      {scanResult.kind === 'found' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1">
                {scanResult.product.categ_id?.[1] || ''}
              </p>
              <h3 className="text-[18px] font-bold text-gray-900 leading-tight">
                {scanResult.product.name}
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                {scanResult.product.uom_id?.[1] || 'Units'}
              </p>
            </div>
            <button onClick={handleDismissResult}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200 flex-shrink-0 ml-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {entries[scanResult.product.id] !== undefined && (
            <p className="text-[13px] text-gray-500 mb-3">
              Current count: <span className="font-mono font-semibold text-gray-700">{entries[scanResult.product.id]}</span>
            </p>
          )}

          {/* Qty stepper */}
          <div className="flex items-center justify-center gap-4 mb-5">
            <button onClick={() => setQty((q) => Math.max(0, q - 1))}
              className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none">
              &minus;
            </button>
            <input
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, '');
                if (v === '' || v === '.') { setQty(0); return; }
                const n = parseFloat(v);
                if (!isNaN(n)) setQty(n);
              }}
              className="w-24 h-14 text-center text-[32px] font-mono font-bold text-gray-900 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-green-500"
            />
            <button onClick={() => setQty((q) => q + 1)}
              className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none">
              +
            </button>
          </div>

          <button onClick={handleConfirmCount}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[16px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Confirm count
          </button>
        </div>
      )}

      {/* ── Looking up barcode (loading) ── */}
      {scanResult.kind === 'looking_up' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-center justify-center gap-3 py-6">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
            <span className="text-[15px] text-gray-500 font-mono">{scanResult.barcode}</span>
          </div>
        </div>
      )}

      {/* ── Not in this count list ── */}
      {scanResult.kind === 'not_in_list' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div>
                <p className="text-[15px] font-semibold text-amber-800">{scanResult.productName}</p>
                <p className="text-[13px] text-amber-700 mt-1">Not in this count list</p>
                <p className="text-[12px] text-amber-600/70 mt-0.5 font-mono">{scanResult.barcode}</p>
              </div>
            </div>
          </div>
          <button onClick={handleDismissResult}
            className="w-full py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200">
            Continue scanning
          </button>
        </div>
      )}

      {/* ── Unknown barcode ── */}
      {scanResult.kind === 'unknown' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div>
                <p className="text-[15px] font-semibold text-red-800">Unknown barcode</p>
                <p className="text-[12px] text-red-600/70 mt-0.5 font-mono">{scanResult.barcode}</p>
                {userRole !== 'staff' && (
                  <p className="text-[13px] text-red-700 mt-2">Assign to a product from the product list.</p>
                )}
              </div>
            </div>
          </div>
          <button onClick={handleDismissResult}
            className="w-full py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200">
            Continue scanning
          </button>
        </div>
      )}
    </div>
  );
}
