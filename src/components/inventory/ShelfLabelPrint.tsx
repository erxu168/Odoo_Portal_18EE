'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useZebraBluetooth } from '@/hooks/useZebraBluetooth';
import ZebraPrinterBar from '@/components/ui/ZebraPrinterBar';
import { generateProductStorageZPL } from '@/lib/zpl';
import { locationCode } from '@/lib/location-code';
import { explainPrintFailure, isDeliveryUncertain } from '@/lib/print-errors';
import { LABEL_SIZE_PRESETS } from '@/types/labeling';

/**
 * Sending shelf labels to the printer.
 *
 * One label per (product, place). A batch prints in the order it was given —
 * for a whole shelf that is walking order, so the stack comes off the printer in
 * the order the person sticks them on.
 *
 * The 500ms pause between labels is not superstition: the existing print screens
 * all have it, because a Bluetooth Zebra drops labels when ZPL arrives faster
 * than it can feed.
 */

export interface ShelfLabelJob {
  productId: number;
  productName: string;
  /** Empty → the label prints "No barcode yet" rather than a silent gap. */
  barcode?: string | null;
  /** null → "No storage place set". */
  spotId: number | null;
  spotLabel?: string | null;
  uom?: string | null;
}

const SHELF_SIZE = LABEL_SIZE_PRESETS.find((s) => s.id === '90x60')!;

export default function ShelfLabelPrint({ jobs, onClose }: {
  jobs: ShelfLabelJob[];
  onClose: () => void;
}) {
  // Closing the sheet used to unmount the UI while the loop kept feeding the
  // printer — and reopening started a second one, interleaving two batches onto
  // one roll. The loop checks this and stops. (Codex, 2026-08-04.)
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);
  const ble = useZebraBluetooth();
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  // Sent, but the link died before we could know if it came out — check, don't rerun.
  const [unsure, setUnsure] = useState<string[]>([]);
  // Stickers already off the printer — a rerun after a mid-batch failure must
  // not put a second one on every shelf before it. (Codex round 3.)
  const [printedKeys, setPrintedKeys] = useState<Set<string>>(new Set());
  // Stamped so a sticker left on a shelf that was later renamed can be spotted.
  const [stamp, setStamp] = useState(true);
  // Ethan's ZD421 is 203dpi (he read the sticker). Threaded rather than assumed,
  // because the same model ships at 300 and a 90mm label would then print at
  // 60mm — two thirds — with nothing on screen to explain it.
  const [dpi, setDpi] = useState(203);

  const todayStamp = new Date().toLocaleDateString('de-DE');

  function zplFor(j: ShelfLabelJob): string {
    return generateProductStorageZPL({
      productName: j.productName,
      barcodeValue: (j.barcode || '').trim() || null,
      locationLabel: j.spotLabel || null,
      locationCode: j.spotId != null ? locationCode(j.spotId) : null,
      uom: j.uom || null,
      printedOn: stamp ? todayStamp : null,
    }, { widthMm: SHELF_SIZE.widthMm, heightMm: SHELF_SIZE.heightMm, dpi });
  }

  async function printAll() {
    if (printing || !ble.isConnected) return;
    setPrinting(true);
    setError(null);
    setDone(0);
    setFailed([]);
    setUnsure([]);
    const alreadyPrinted = printedKeys;
    for (const j of jobs) {
      if (stopped.current) break;
      const key = `${j.productId}:${j.spotId ?? 'none'}`;
      if (alreadyPrinted.has(key)) { setDone((n) => n + 1); continue; }
      try {
        const ok = await ble.print(zplFor(j));
        if (ok) {
          setDone((n) => n + 1);
          setPrintedKeys((p) => new Set([...Array.from(p), key]));
        }
        // A failure names the label rather than aborting the batch: with 40
        // stickers you need to know WHICH three to run again, not that
        // "printing failed". The REASON goes in the banner once — repeating it
        // per sticker would bury the list it sits above.
        else {
          // Read the reason NOW, not inside the updater: the batch carries on,
          // and the next ble.print() clears the ref. React may run the updater
          // after that, which would blame this failure on a later label — or
          // on nothing at all. (Codex review of 627df661.)
          const raw = ble.lastError();
          const reason = explainPrintFailure(raw);
          const name = `${j.productName} — ${j.spotLabel || 'no place'}`;
          // "did not print" is a claim, and for a dropped link it is one we
          // cannot make. Listing an uncertain sticker under it invites someone
          // to run it again and put a SECOND one on the shelf. Say which it is.
          // (Codex re-review of de32d7b8.)
          if (isDeliveryUncertain(raw)) setUnsure((f) => [...f, name]);
          else setFailed((f) => [...f, name]);
          setError((prev) => prev ?? reason);
        }
      } catch (err: unknown) {
        // This used to record the NAME and bin the cause, which is the exact
        // dead end this whole change set exists to remove. (Codex round 4.)
        setFailed((f) => [...f, `${j.productName} — ${j.spotLabel || 'no place'}`]);
        const reason = explainPrintFailure(err instanceof Error ? err.message : String(err));
        setError((prev) => prev ?? reason);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    setPrinting(false);
  }

  const noCode = jobs.filter((j) => !j.barcode).length;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl pb-8 max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5">
          <h3 className="text-[var(--fs-lg)] font-bold">
            {jobs.length === 1 ? 'Print this label' : `Print ${jobs.length} labels`}
          </h3>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-1">
            {SHELF_SIZE.name} · one for each place
          </p>
        </div>

        <ZebraPrinterBar ble={ble} onError={setError} />

        <div className="px-5 pt-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-red-700 text-[var(--fs-xs)] mb-3">
              {error}
            </div>
          )}

          {noCode > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-amber-800 text-[var(--fs-xs)] mb-3 leading-relaxed">
              {noCode === 1 ? 'One label has' : `${noCode} labels have`} no barcode to scan. They will
              print and say so — give the product a code first if you want it scannable.
            </div>
          )}

          {/* Only two Zebras exist in this range and the wrong one prints
              everything at two-thirds size, so it is a visible choice rather
              than a silent assumption. */}
          <div className="flex items-center gap-2 py-2">
            <span className="text-[12px] text-gray-500 font-semibold">Printer</span>
            {[203, 300].map((d) => (
              <button key={d} onClick={() => setDpi(d)}
                className={`px-2.5 h-8 rounded-lg text-[12px] font-bold border ${
                  dpi === d ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-600'
                }`}>
                {d} dpi
              </button>
            ))}
          </div>

          <button onClick={() => setStamp(!stamp)} className="w-full flex items-center gap-2.5 py-2 text-left">
            <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center text-[11px] font-black flex-shrink-0 ${
              stamp ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 text-transparent'
            }`}>✓</span>
            <span className="text-[13px] text-gray-700">
              Print today’s date in the corner
              <span className="block text-[11px] text-gray-400">so a sticker on a renamed shelf can be spotted</span>
            </span>
          </button>

          <ul className="mt-2 mb-4 max-h-40 overflow-y-auto">
            {jobs.map((j, i) => (
              <li key={`${j.productId}-${j.spotId}-${i}`} className="flex items-center gap-2 py-1.5 text-[13px] border-t border-gray-100 first:border-t-0">
                <span className="min-w-0 flex-1 font-semibold text-gray-800 [overflow-wrap:anywhere]">{j.productName}</span>
                <span className="text-[11px] text-gray-500 flex-shrink-0 max-w-[45%] truncate">{j.spotLabel || 'no place'}</span>
              </li>
            ))}
          </ul>

          {(done > 0 || failed.length > 0 || unsure.length > 0) && (
            <div className="mb-3 text-[13px]">
              <span className="font-bold text-green-700">{done} printed</span>
              {failed.length > 0 && (
                <div className="mt-1.5 text-red-700">
                  <div className="font-bold">{failed.length} did not print:</div>
                  {failed.map((f) => <div key={f} className="text-[12px]">· {f}</div>)}
                </div>
              )}
              {unsure.length > 0 && (
                <div className="mt-1.5 text-amber-700">
                  <div className="font-bold">
                    {unsure.length === 1 ? 'One may have printed' : `${unsure.length} may have printed`} — check the printer before running {unsure.length === 1 ? 'it' : 'them'} again:
                  </div>
                  {unsure.map((f) => <div key={f} className="text-[12px]">· {f}</div>)}
                </div>
              )}
            </div>
          )}

          <button onClick={printAll} disabled={!ble.isConnected || printing}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">
            {printing ? `Printing ${done + 1} of ${jobs.length}…`
              : !ble.isConnected ? 'Connect a printer first'
              : jobs.length === 1 ? 'Print' : `Print ${jobs.length} labels`}
          </button>
          <button onClick={onClose} className="w-full py-3 text-[var(--fs-sm)] text-gray-500 font-semibold mt-1">
            {done > 0 ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
