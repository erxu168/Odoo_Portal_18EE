'use client';

import React, { useMemo, useState } from 'react';
import { houseCode, needsHouseCode } from '@/lib/product-code';
import { locationCode } from '@/lib/location-code';

/**
 * THE SHELF LABEL, on the product's own page.
 *
 * Ethan, 2026-08-04: "I want for each product to have a section where I have a
 * label for that product and that label will be printed so that I can attach
 * them to their storage location."
 *
 * A product kept in two places gets TWO labels, one per place, each naming its
 * own shelf — a label listing both is confusing when you are standing at one of
 * them. Both are ticked by default; untick one to print only the shelf you are
 * at.
 *
 * The preview here and the printed label MUST agree. The printer gets its layout
 * from generateProductStorageZPL, so this preview describes the same blocks in
 * the same order and takes its numbers from the same place — the existing food
 * label's preview is a hand-written copy that has already drifted from its
 * printer output, and repeating that is the one thing to avoid (CLAUDE.md
 * design principle 2).
 */

interface Props {
  product: { id: number; name: string; uom_id?: [number, string]; barcode?: string | false };
  /** The live value from the page's own barcode field, so this reacts as it is edited. */
  barcode: string;
  homeSpots: number[];
  spotLabels: Record<number, string>;
  readOnly?: boolean;
  onCodeAssigned: (code: string) => void;
}

export default function ShelfLabelSection({
  product, barcode, homeSpots, spotLabels, readOnly, onCodeAssigned,
}: Props) {
  // Which places to print for. All of them, until the manager says otherwise.
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const picked = chosen ?? new Set(homeSpots);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noCode = needsHouseCode(barcode);
  const uom = product.uom_id?.[1] || null;
  // The shelf shown in the preview is whichever is ticked first — the label is
  // per place, so previewing "all of them at once" would be a lie.
  const previewSpot = useMemo(
    () => homeSpots.find((s) => picked.has(s)) ?? homeSpots[0] ?? null,
    [homeSpots, picked],
  );

  function toggle(spotId: number) {
    const next = new Set(picked);
    if (next.has(spotId)) next.delete(spotId); else next.add(spotId);
    setChosen(next);
  }

  async function assignCode() {
    if (assigning) return;
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/product-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: [product.id] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not give this product a code.'); return; }
      const got = (data.assigned || [])[0];
      if (got) { onCodeAssigned(got.code); return; }
      // Skipped rather than assigned — say WHY rather than look like nothing happened.
      const why = (data.skipped || [])[0]?.reason;
      setError(why ? `Not done — ${why}` : 'Nothing to do: this product already has a code.');
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="mb-8">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Shelf label</div>

      <div className="flex gap-3 items-start">
        {/* The preview, at the real 90 × 60 shape. */}
        <div className="w-[46%] flex-shrink-0">
          <div className="bg-white border border-gray-200 rounded-md p-[6%] text-black"
               style={{ aspectRatio: '90 / 60', display: 'flex', flexDirection: 'column' }}>
            <div className="font-extrabold leading-none [overflow-wrap:anywhere]"
                 style={{ fontSize: product.name.length > 18 ? '11px' : '14px', letterSpacing: '-0.02em' }}>
              {product.name}
            </div>
            {uom && <div className="text-[7px] text-gray-500 font-semibold mt-[3%]">counted in {uom}</div>}
            <div className="mt-auto">
              {noCode ? (
                <div className="text-[8px] font-bold text-amber-700">No barcode yet</div>
              ) : (
                <>
                  <div style={{ height: '18%', minHeight: 12, background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px,#000 4px 5px,#fff 5px 8px)' }} />
                  <div className="text-[7px] font-mono font-bold mt-[2%]">{barcode}</div>
                </>
              )}
              <div className="border-t border-black mt-[4%] pt-[3%] text-[7px] font-semibold text-gray-700 leading-tight [overflow-wrap:anywhere]">
                {previewSpot != null
                  ? <>{spotLabels[previewSpot] || `Spot ${previewSpot}`}<div className="font-mono text-gray-500">{locationCode(previewSpot)}</div></>
                  : <span className="text-amber-700">No storage place set</span>}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-gray-400 font-semibold text-center mt-1">90 × 60 mm</div>
        </div>

        {/* What it will carry, and the one thing that might be missing. */}
        <div className="flex-1 min-w-0">
          {noCode ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[13px] text-amber-800 leading-relaxed">
                This product has no barcode, so its label would have nothing to scan.
              </p>
              {!readOnly && (
                <button onClick={assignCode} disabled={assigning}
                  className="mt-2.5 w-full py-2.5 rounded-lg bg-green-600 text-white text-[13px] font-bold disabled:opacity-50">
                  {assigning ? 'Giving it a code…' : `Give it a code (${houseCode(product.id)})`}
                </button>
              )}
            </div>
          ) : (
            <div className="text-[13px] text-gray-600 leading-relaxed">
              Scanning this label finds <span className="font-semibold text-gray-900">{product.name}</span> straight away.
            </div>
          )}

          {error && <p className="mt-2 text-[12px] text-red-600 leading-snug">{error}</p>}

          {homeSpots.length > 1 && (
            <div className="mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                One label for each place
              </div>
              {homeSpots.map((sid) => (
                <button key={sid} onClick={() => toggle(sid)}
                  className="w-full flex items-center gap-2.5 py-1.5 text-left">
                  <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center text-[11px] font-black flex-shrink-0 ${
                    picked.has(sid) ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 text-transparent'
                  }`}>✓</span>
                  <span className="min-w-0 flex-1 text-[13px] font-semibold text-gray-800 [overflow-wrap:anywhere]">
                    {spotLabels[sid] || `Spot ${sid}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {homeSpots.length === 0 && (
        <p className="mt-2 text-[12px] text-amber-700 leading-snug">
          No storage place set yet — the label will print without one. Set where it lives and
          it lands on the right counting walk too.
        </p>
      )}
    </div>
  );
}
