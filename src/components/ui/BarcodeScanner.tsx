'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ───── Types ───── */

type ScanResult =
  | { kind: 'scanning' }
  | { kind: 'found'; product: any; isDraft?: boolean }
  | { kind: 'looking_up'; barcode: string }
  | { kind: 'not_in_list'; barcode: string; productName: string; isDraft?: boolean }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'creating'; barcode: string; name: string }
  | { kind: 'manual' };

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  products: any[];
  entries: Record<number, number>;
  totalCount: number;
  countedCount: number;
  onCount: (productId: number, qty: number, uom: string) => void;
  userRole: string;
  title?: string;
  /** Barcode from hardware scanner — process immediately without camera */
  pendingBarcode?: string;
  onPendingConsumed?: () => void;
}

const READER_ID = 'krawings-barcode-reader';

/**
 * Check if the native KrawingsScanner bridge is available.
 * Injected by BarcodeScannerBridge.java via @JavascriptInterface.
 */
function hasNativeScanner(): boolean {
  try {
    return (window as any).KrawingsScanner?.isAvailable?.() === true;
  } catch (_e) { return false; }
}

/**
 * Trigger native ML Kit scan. Returns a promise that resolves with
 * the barcode string, or null if cancelled/error.
 */
function doNativeScan(): Promise<string | null> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      window.removeEventListener('nativeBarcodeScan', handler);
      const detail = (e as CustomEvent).detail || {};
      if (detail.barcode) {
        resolve(detail.barcode);
      } else {
        resolve(null);
      }
    };
    window.addEventListener('nativeBarcodeScan', handler);
    (window as any).KrawingsScanner.scan();
  });
}

export default function BarcodeScanner({
  open, onClose, products, entries, totalCount, countedCount,
  onCount, userRole, title = 'Scan product',
  pendingBarcode, onPendingConsumed,
}: BarcodeScannerProps) {
  const [scanResult, setScanResult] = useState<ScanResult>({ kind: 'scanning' });
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'warning' } | null>(null);
  const [manualValue, setManualValue] = useState('');
  // null = still detecting, true = native available, false = web fallback
  const [isNative, setIsNative] = useState<boolean | null>(null);

  const scannerRef = useRef<any>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  const productsRef = useRef(products);
  productsRef.current = products;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /* ───── Detect native scanner (JavascriptInterface) ───── */

  useEffect(() => {
    // KrawingsScanner is injected synchronously by the native WebView,
    // so it is available immediately — no polling needed.
    const native = hasNativeScanner();
    console.debug('[BarcodeScanner] native scanner:', native);
    setIsNative(native);
  }, []);

  /* ───── Process pending barcode from hardware scanner ───── */

  useEffect(() => {
    if (open && pendingBarcode) {
      processBarcodeRef.current(pendingBarcode);
      onPendingConsumed?.();
    }
  }, [open, pendingBarcode, onPendingConsumed]);

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

  /* ───── Barcode processing ───── */

  const processBarcode = useCallback(async (barcode: string) => {
    const prods = productsRef.current;
    const ents = entriesRef.current;

    const product = prods.find((p: any) => p.barcode && p.barcode === barcode);
    if (product) {
      const currentQty = ents[product.id];
      setQty(currentQty !== undefined ? currentQty + 1 : 1);
      setScanResult({ kind: 'found', product, isDraft: product.is_draft === true });
      try { navigator.vibrate(100); } catch (_e) { /* ignore */ }
      return;
    }

    setScanResult({ kind: 'looking_up', barcode });
    try { navigator.vibrate(100); } catch (_e) { /* ignore */ }

    try {
      const res = await fetch(`/api/inventory/barcode-lookup?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (data.found && data.product) {
        // Draft product hit → treat as "found" with a Pending badge so staff
        // can add qty immediately (dedupe of rescan during walk-around).
        if (data.is_draft) {
          const currentQty = ents[data.product.id];
          setQty(currentQty !== undefined ? currentQty + 1 : 1);
          setScanResult({ kind: 'found', product: data.product, isDraft: true });
          return;
        }
        setScanResult({ kind: 'not_in_list', barcode, productName: data.product.name });
      } else {
        setScanResult({ kind: 'unknown', barcode });
      }
    } catch (_err) {
      setScanResult({ kind: 'unknown', barcode });
    }
  }, []);

  const processBarcodeRef = useRef(processBarcode);
  processBarcodeRef.current = processBarcode;

  const isManual = scanResult.kind === 'manual';
  const wantWebCamera = open && isNative === false && !isManual;

  /* ───── Native ML Kit scanning (via JavascriptInterface) ───── */

  useEffect(() => {
    if (!open || isNative !== true || scanResult.kind !== 'scanning') return;
    if (isManual) return;
    if (pendingBarcode) return; // hardware scanner handles this

    let cancelled = false;

    async function triggerScan() {
      try {
        const barcode = await doNativeScan();
        if (cancelled) return;

        if (barcode) {
          processBarcodeRef.current(barcode);
        } else {
          // User cancelled
          onClose();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('[BarcodeScanner] native scan error:', err);
        setIsNative(false); // fall back to web
      }
    }

    const timer = setTimeout(triggerScan, 100);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isNative, scanResult.kind, isManual]);

  /* ───── html5-qrcode fallback (web only) ───── */

  useEffect(() => {
    if (!wantWebCamera) {
      stopScanner();
      return;
    }
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
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 120 }, disableFlip: false },
          (decoded: string) => { processBarcodeRef.current(decoded); },
          () => {},
        );

        if (!cancelled) {
          setCameraReady(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[BarcodeScanner] web camera error:', msg);
        if (msg.includes('Permission') || msg.includes('NotAllowed')) {
          setError('Camera access denied. Check browser or app permissions.');
        } else {
          setError('Camera error. Use manual entry.');
        }
      }
    };

    const timer = setTimeout(start, 200);
    return () => { cancelled = true; clearTimeout(timer); stopScanner(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantWebCamera]);

  // Pause/resume web scanner when result card is shown
  useEffect(() => {
    if (!scannerRef.current || isNative !== false) return;
    const hasResult = scanResult.kind === 'found' || scanResult.kind === 'not_in_list'
      || scanResult.kind === 'unknown' || scanResult.kind === 'looking_up';
    if (hasResult) {
      try { scannerRef.current.pause(false); } catch (_e) { /* ignore */ }
    } else if (scanResult.kind === 'scanning') {
      try { scannerRef.current.resume(); } catch (_e) { /* ignore */ }
    }
  }, [scanResult.kind, isNative]);

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
    setScanResult({ kind: 'scanning' });
  }

  async function handleDraftCreated(product: any, qtyValue: number) {
    // Merge into local products cache so an immediate rescan matches locally
    productsRef.current = [...productsRef.current, product];

    const uom = product.uom_id?.[1] || 'Units';
    onCount(product.id, qtyValue, uom);
    showToast(`${product.name} \u2192 ${qtyValue} ${uom}`, 'success');
    setScanResult({ kind: 'scanning' });
  }

  function handleDismissResult() {
    setScanResult({ kind: 'scanning' });
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

      {/* ── Native: scanning state (camera handled natively) ── */}
      {isNative && scanResult.kind === 'scanning' && !isManual && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-white/50 text-[14px]">Opening scanner...</p>
        </div>
      )}

      {/* ── Still detecting bridge ── */}
      {isNative === null && !isManual && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mb-3" />
          <p className="text-white/40 text-[13px]">Detecting scanner...</p>
        </div>
      )}

      {/* ── Web camera view (html5-qrcode fallback) ── */}
      {isNative === false && (
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
      )}

      {/* ── Manual entry ── */}
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

      {/* ── Toast ── */}
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

      {/* ── Product found card ── */}
      {scanResult.kind === 'found' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400">
                  {scanResult.product.categ_id?.[1] || ''}
                </p>
                {scanResult.isDraft && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    Pending review
                  </span>
                )}
              </div>
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

      {/* ── Looking up ── */}
      {scanResult.kind === 'looking_up' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-center justify-center gap-3 py-6">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
            <span className="text-[15px] text-gray-500 font-mono">{scanResult.barcode}</span>
          </div>
        </div>
      )}

      {/* ── Not in list ── */}
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
            Scan next
          </button>
        </div>
      )}

      {/* ── Unknown barcode — create draft + count ── */}
      {scanResult.kind === 'unknown' && (
        <UnknownBarcodeSheet
          barcode={scanResult.barcode}
          onCancel={handleDismissResult}
          onCreated={handleDraftCreated}
        />
      )}

      {/* ── Creating draft (API in flight) ── */}
      {scanResult.kind === 'creating' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-center justify-center gap-3 py-6">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-[#F5800A] rounded-full animate-spin" />
            <span className="text-[15px] text-gray-600">Creating &quot;{scanResult.name}&quot;...</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───── UnknownBarcodeSheet ───── */

interface UnknownBarcodeSheetProps {
  barcode: string;
  onCancel: () => void;
  onCreated: (product: any, qty: number) => void;
}

function UnknownBarcodeSheet({ barcode, onCancel, onCreated }: UnknownBarcodeSheetProps) {
  const [name, setName] = useState('');
  const [qtyValue, setQtyValue] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create');
        setSubmitting(false);
        return;
      }
      onCreated(data.product, qtyValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
      <div className="mb-3">
        <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1">New product</p>
        <p className="text-[12px] text-gray-500 font-mono">{barcode}</p>
      </div>

      <label className="text-[13px] font-semibold text-gray-600 mb-2 block">What is this item?</label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length >= 2) handleCreate(); }}
        placeholder="e.g. Pork belly"
        className="w-full px-4 py-3 rounded-xl bg-gray-50 border-2 border-gray-200 text-[16px] text-gray-900 focus:outline-none focus:border-[#F5800A] mb-4"
        disabled={submitting}
      />

      <div className="flex items-center justify-center gap-4 mb-5">
        <button
          onClick={() => setQtyValue((q) => Math.max(0, q - 1))}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >&minus;</button>
        <input
          type="text"
          inputMode="decimal"
          value={qtyValue}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '');
            if (v === '' || v === '.') { setQtyValue(0); return; }
            const n = parseFloat(v);
            if (!isNaN(n)) setQtyValue(n);
          }}
          className="w-24 h-14 text-center text-[32px] font-mono font-bold text-gray-900 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#F5800A]"
          disabled={submitting}
        />
        <button
          onClick={() => setQtyValue((q) => q + 1)}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >+</button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200 disabled:opacity-50"
        >Cancel</button>
        <button
          onClick={handleCreate}
          disabled={submitting || name.trim().length < 2}
          className="flex-[2] py-3.5 rounded-xl bg-[#F5800A] text-white text-[15px] font-bold shadow-md shadow-[#F5800A]/30 active:bg-[#E86000] active:scale-[0.975] transition-all disabled:opacity-40"
        >{submitting ? 'Creating...' : 'Create and count'}</button>
      </div>
    </div>
  );
}
