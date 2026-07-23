'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { buildLocationTree } from '@/lib/location-tree';
import { locationCode } from '@/lib/location-code';

/**
 * Printable location labels — a QR + name for every count location, so staff can
 * find (and later scan) places. Prints on any normal printer via the browser.
 * Rendered into a body-level portal so print CSS can hide the whole app and show
 * only the labels (no blank/repeated pages).
 */
interface LocRow { id: number; parent_id: number | null; name: string; sort_order: number }
interface Label { id: number; name: string; area: string | null; code: string; qr: string }

export default function LocationLabels({ companyId, onClose }: { companyId: number; onClose: () => void }) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Lock the page behind us while open (no nested/chained scrolling).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    let stale = false;
    setLoading(true); setError(null); setLabels([]);
    (async () => {
      try {
        const d = await fetch(`/api/inventory/count-locations?company_id=${companyId}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))));
        const locs: LocRow[] = d.locations || [];
        // Walking order = the manager's arrangement: areas by sort_order, each
        // area's spots after it. buildLocationTree already applies sort_order.
        const tree = buildLocationTree(locs) as (LocRow & { children?: LocRow[] })[];
        const ordered: { row: LocRow; area: string | null }[] = [];
        for (const area of tree) {
          ordered.push({ row: area, area: null });
          for (const spot of (area.children || [])) ordered.push({ row: spot, area: area.name });
        }
        const built = await Promise.all(ordered.map(async ({ row, area }) => {
          const code = locationCode(row.id);
          const qr = await QRCode.toDataURL(code, { width: 240, margin: 1 });
          return { id: row.id, name: row.name, area, code, qr };
        }));
        if (!stale) { setLabels(built); setLoading(false); }
      } catch {
        if (!stale) { setError('Could not load the locations.'); setLoading(false); }
      }
    })();
    return () => { stale = true; };
  }, [companyId]);

  if (!mounted) return null;

  return createPortal(
    <div className="kw-print-portal fixed inset-0 z-[120] bg-white flex flex-col">
      <style>{`
        @media print {
          body > *:not(.kw-print-portal) { display: none !important; }
          .kw-print-portal { position: static !important; inset: auto !important; height: auto !important; overflow: visible !important; background: #fff; }
          .kw-no-print { display: none !important; }
          .kw-scroll { overflow: visible !important; height: auto !important; }
          .kw-labels { padding: 6mm !important; }
          .kw-label { break-inside: avoid; }
        }
      `}</style>

      <div className="kw-no-print px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Print location labels</h3>
          <p className="text-[var(--fs-xs)] text-gray-500">Stick these on your shelves &amp; drawers so staff can find (and scan) them</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Done</button>
          <button onClick={() => window.print()} disabled={loading || !!error || labels.length === 0}
            className="px-5 py-2 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Print</button>
        </div>
      </div>

      <div className="kw-scroll flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-center text-gray-400 py-16">Preparing labels…</p>
        ) : error ? (
          <p className="text-center text-red-600 py-16 font-semibold">{error}</p>
        ) : labels.length === 0 ? (
          <p className="text-center text-gray-400 py-16">No locations yet — set them up first.</p>
        ) : (
          <div className="kw-labels grid grid-cols-2 gap-3 p-4">
            {labels.map((l) => (
              <div key={l.id} className="kw-label border-2 border-gray-300 rounded-xl p-3 flex items-center gap-3 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.qr} alt="" width={88} height={88} className="flex-shrink-0" />
                <div className="min-w-0">
                  {l.area && <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 truncate">{l.area}</div>}
                  <div className="text-[17px] font-extrabold text-gray-900 leading-tight break-words">{l.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5">{l.code}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
