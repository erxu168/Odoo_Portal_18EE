'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { buildLocationTree, locationPath } from '@/lib/location-tree';
import { useLocationTypes } from '@/lib/use-location-types';
import { locationCode } from '@/lib/location-code';
import { useZebraBluetooth } from '@/hooks/useZebraBluetooth';
import { generateLocationZPL } from '@/lib/zpl';

/**
 * Printable location labels — a QR and the place's name, to stick on the shelf.
 *
 * Sized for real label stock rather than an A4 sheet: one label per page at
 * exactly the roll's dimensions, which is what a Zebra (and every other label
 * printer) expects. The size is chosen here rather than assumed, because the
 * roll in the machine is not something the portal can know.
 *
 * How much of the path each label carries is also a choice. "D4" alone is
 * useless on a drawer once there are two of them; the whole chain is unreadable
 * from across a kitchen. Default is the place plus its parent.
 */

interface LocRow { id: number; parent_id: number | null; name: string; sort_order: number; kind: string }
interface Label { id: number; name: string; branch: string; code: string; qr: string; icon: string }

/**
 * Label stock, then ordinary paper. A4 is not a different mode — it is simply a
 * very large label, one place per sheet, so a shelf sign printed on the office
 * inkjet reads from across the room. Everything on the label is proportional,
 * so the same code fills 57 × 32 mm and 210 × 297 mm.
 */
const SIZES = [
  { id: '75x50', label: '75 × 50', w: 75, h: 50 },
  { id: '57x32', label: '57 × 32', w: 57, h: 32 },
  { id: '100x50', label: '100 × 50', w: 100, h: 50 },
  { id: 'a5', label: 'A5', w: 148, h: 210 },
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a4l', label: 'A4 wide', w: 297, h: 210 },
] as const;

/**
 * Proportions that hold at 57 mm stop holding at 297 mm — a QR at 42% of an A4
 * sheet is 12 cm across, which is absurd on a sign nobody scans from a metre
 * away. Everything below is a fraction of the label, capped at what still makes
 * sense on paper.
 */
const qrMm = (h: number) => Math.min(h * 0.42, 45);
const smallMm = (h: number) => Math.min(Math.max(1.8, h * 0.055), 6);
const branchMm = (h: number) => Math.min(Math.max(2, h * 0.062), 9);

type Depth = 'leaf' | 'parent' | 'full';

export default function LocationLabels({ companyId, onClose, onlyId }: { companyId: number; onClose: () => void; onlyId?: number }) {
  const [rows, setRows] = useState<LocRow[]>([]);
  // EVERY location, kept apart from the ones being printed. A path is walked by
  // following parent_id through this list, so printing a single label must not
  // narrow it — filtering to one row left that row with no ancestors to find,
  // and "+ parent" and "Full path" silently printed nothing above the name.
  const [allLocs, setAllLocs] = useState<LocRow[]>([]);
  const [qrByLoc, setQrByLoc] = useState<Record<number, string>>({});
  // The SAME Zebra hook manufacturing uses — one Bluetooth implementation for
  // the whole portal, native Classic in the Android app and Web BLE in a
  // browser. Paper printing stays exactly as it was; this is a second way out,
  // not a replacement.
  const zebra = useZebraBluetooth();
  const [zebraMsg, setZebraMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [sizeId, setSizeId] = useState<string>('75x50');
  const [customW, setCustomW] = useState('75');
  const [customH, setCustomH] = useState('50');
  const [depth, setDepth] = useState<Depth>('parent');
  const [withQr, setWithQr] = useState(true);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const { iconOf } = useLocationTypes(companyId);

  useEffect(() => {
    let stale = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const d = await fetch(`/api/inventory/count-locations?company_id=${companyId}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))));
        const locs: LocRow[] = d.locations || [];
        // Walking order = the manager's arrangement, depth-first to any depth,
        // so the labels come off the printer in the order you walk the room.
        const ordered: LocRow[] = [];
        const walk = (nodes: (LocRow & { children?: LocRow[] })[]) => {
          for (const n of nodes) { ordered.push(n); walk(n.children || []); }
        };
        walk(buildLocationTree(locs) as (LocRow & { children?: LocRow[] })[]);
        const wanted = onlyId != null ? ordered.filter((r) => r.id === onlyId) : ordered;
        const qrs: Record<number, string> = {};
        await Promise.all(wanted.map(async (row) => {
          qrs[row.id] = await QRCode.toDataURL(locationCode(row.id), { width: 240, margin: 0 });
        }));
        if (!stale) { setAllLocs(locs); setRows(wanted); setQrByLoc(qrs); setLoading(false); }
      } catch {
        if (!stale) { setError('Could not load the locations.'); setLoading(false); }
      }
    })();
    return () => { stale = true; };
  }, [companyId, onlyId]);

  const size = useMemo(() => {
    if (sizeId !== 'custom') return SIZES.find((s) => s.id === sizeId) || SIZES[0];
    const w = Math.min(300, Math.max(20, Number(customW) || 75));
    const h = Math.min(300, Math.max(15, Number(customH) || 50));
    return { id: 'custom', label: 'Custom', w, h };
  }, [sizeId, customW, customH]);

  const labels: Label[] = useMemo(() => rows.map((row) => {
    const path = locationPath(row.id, allLocs);
    const above = path.slice(0, -1);
    const branch = depth === 'leaf' ? ''
      : depth === 'parent' ? (above[above.length - 1] || '')
      : above.join(' › ');
    return {
      id: row.id,
      name: row.name,
      branch,
      code: locationCode(row.id),
      qr: qrByLoc[row.id] || '',
      icon: iconOf(row.kind),
    };
  }), [rows, allLocs, depth, qrByLoc, iconOf]);

  async function connectZebra() {
    setZebraMsg(null);
    const ok = await zebra.connect();
    if (!ok) setZebraMsg(zebra.error || 'Could not connect to the printer.');
  }

  /**
   * Send the labels to the Zebra as ZPL.
   *
   * The printer is told the size we are printing at, so what comes out matches
   * what is on screen even when the roll loaded is a different one. Sent one
   * label at a time, and stopped at the first failure rather than firing the
   * rest at a printer that is not listening — a jam should cost one label, not
   * the whole batch.
   */
  async function printToZebra() {
    setZebraMsg(null);
    let done = 0;
    for (const l of labels) {
      const zpl = generateLocationZPL(
        { name: l.name, branch: l.branch, code: l.code },
        { widthMm: size.w, heightMm: size.h },
      );
      const ok = await zebra.print(zpl);
      if (!ok) {
        setZebraMsg(`${done} of ${labels.length} printed, then: ${zebra.error || 'the printer stopped responding'}.`);
        return;
      }
      done += 1;
    }
    setZebraMsg(`${done} label${done === 1 ? '' : 's'} sent to ${zebra.printerName || 'the printer'}.`);
  }

  const printing = labels.filter((l) => !skipped.has(l.id));

  // What the chosen depth DOES, spelled out on a real place from this batch.
  // Switching between the three looks identical when the only place being
  // printed is top-level — there is nothing above it to show — and that reads
  // as a broken preview rather than as "this one has no parent".
  const depthNote = useMemo(() => {
    let deepest: LocRow | null = null;
    let best = 0;
    for (const r of rows) {
      const d = locationPath(r.id, allLocs).length;
      if (d > best) { best = d; deepest = r; }
    }
    if (!deepest) return null;
    const path = locationPath(deepest.id, allLocs);
    if (path.length < 2) {
      return `Every place here is top-level, so all three read the same — there is nothing above ${path[0] || 'them'} to show.`;
    }
    const above = path.slice(0, -1);
    const shown = depth === 'leaf' ? ''
      : depth === 'parent' ? (above[above.length - 1] || '')
      : above.join(' › ');
    return `For example: ${shown ? `${shown} · ` : ''}${path[path.length - 1]}`;
  }, [rows, allLocs, depth]);

  // The name has to be legible from across a room, so it is sized to the label
  // and to how long it is — rather than shrunk to fit and unreadable, or cut off.
  const nameMm = (name: string, hasBranch: boolean) => {
    // Whatever is left after the branch line, the footer and the padding — the
    // name gets that and no more. Sizing on width alone let "WAJ Kitchen" wrap
    // to two big lines and shove the QR off the bottom edge.
    const pad = Math.min(Math.max(1.5, size.h * 0.06), 10) * 2;
    const branchH = hasBranch ? branchMm(size.h) * 1.15 : 0;
    const footerH = withQr ? qrMm(size.h) : smallMm(size.h) * 1.2;
    const room = Math.max(3, size.h - pad - branchH - footerH - size.h * 0.04);

    const words = name.trim().split(/\s+/).filter(Boolean);
    const longest = words.reduce((a, w) => Math.max(a, w.length), 0) || 2;
    const byWidth = (size.w * 0.86) / Math.max(2, longest) * 1.75;
    // How many lines that width implies, and therefore what height it needs.
    const perLine = Math.max(1, Math.floor((size.w * 0.86) / (byWidth * 0.55)));
    const lines = Math.max(1, Math.ceil(name.length / Math.max(1, perLine)));
    const byHeight = room / (lines * 1.05);
    return Math.max(2.6, Math.min(size.w / 4.6, byWidth, byHeight));
  };

  if (!mounted) return null;

  return createPortal(
    <div className="kw-print-portal fixed inset-0 z-[120] bg-gray-50 flex flex-col">
      <style>{`
        @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
        @media print {
          html, body { width: ${size.w}mm; background: #fff !important; }
          body > *:not(.kw-print-portal) { display: none !important; }
          .kw-print-portal { position: static !important; inset: auto !important; height: auto !important;
                             overflow: visible !important; background: #fff !important; display: block !important; }
          .kw-no-print { display: none !important; }
          .kw-scroll { overflow: visible !important; height: auto !important; padding: 0 !important; }
          .kw-sheet { display: block !important; padding: 0 !important; gap: 0 !important; }
          /* One label per page — that is what a label roll IS. */
          .kw-label { break-after: page; page-break-after: always; box-shadow: none !important;
                      border: 0 !important; margin: 0 !important; border-radius: 0 !important; }
          .kw-label:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div className="kw-no-print px-5 pt-4 pb-3 border-b border-gray-200 bg-white flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-gray-900">Print location labels</h3>
          <p className="text-[var(--fs-xs)] text-gray-500 truncate">
            {printing.length} label{printing.length === 1 ? '' : 's'} · {size.w} × {size.h} mm
            {zebra.isConnected && <span className="text-gray-900 font-semibold"> · {zebra.printerName || 'Zebra'} connected</span>}
          </p>
          {zebraMsg && (
            <p className="text-[var(--fs-xs)] font-semibold text-gray-900 mt-0.5 [overflow-wrap:anywhere]">{zebraMsg}</p>
          )}
          {zebra.error && !zebraMsg && (
            <p className="text-[var(--fs-xs)] font-semibold text-red-700 mt-0.5 [overflow-wrap:anywhere]">{zebra.error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70 px-2">Done</button>
          {zebra.isSupported && (
            zebra.isConnected ? (
              <button onClick={printToZebra} disabled={zebra.status === 'printing' || printing.length === 0}
                className="px-4 py-2 rounded-xl bg-gray-900 text-white font-bold disabled:opacity-40 active:bg-black">
                {zebra.status === 'printing' ? 'Printing…' : `Zebra (${printing.length})`}
              </button>
            ) : (
              <button onClick={connectZebra} disabled={zebra.status === 'connecting' || zebra.status === 'scanning'}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 font-bold disabled:opacity-40 active:bg-gray-50">
                {zebra.status === 'connecting' || zebra.status === 'scanning' ? 'Connecting…' : 'Connect Zebra'}
              </button>
            )
          )}
          <button onClick={() => window.print()} disabled={loading || !!error || printing.length === 0}
            className="px-5 py-2 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 active:bg-green-700">Print</button>
        </div>
      </div>

      <div className="kw-no-print px-5 py-3 border-b border-gray-200 bg-white flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-1.5">Label size</div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {SIZES.map((s) => (
              <button key={s.id} onClick={() => setSizeId(s.id)}
                className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${sizeId === s.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
                {s.label}
              </button>
            ))}
            <button onClick={() => setSizeId('custom')}
              className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${sizeId === 'custom' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
              Custom
            </button>
            {sizeId === 'custom' && (
              <span className="flex items-center gap-1.5">
                <input value={customW} onChange={(e) => setCustomW(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal" aria-label="Label width in mm"
                  className="w-16 h-9 border border-gray-200 rounded-lg text-center font-mono font-bold" />
                <span className="text-gray-400 text-[13px]">×</span>
                <input value={customH} onChange={(e) => setCustomH(e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal" aria-label="Label height in mm"
                  className="w-16 h-9 border border-gray-200 rounded-lg text-center font-mono font-bold" />
                <span className="text-gray-400 text-[13px]">mm</span>
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-1.5">How much of the path</div>
          <div className="flex gap-1.5">
            {([['leaf', 'Place only'], ['parent', '+ parent'], ['full', 'Full path']] as const).map(([d, lbl]) => (
              <button key={d} onClick={() => setDepth(d)}
                className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${depth === d ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-1.5">QR code</div>
          <button onClick={() => setWithQr((v) => !v)}
            className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${withQr ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>
            {withQr ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {depthNote && (
        <p className="kw-no-print px-5 pt-2 text-[var(--fs-xs)] text-gray-500">{depthNote}</p>
      )}

      <p className="kw-no-print px-5 py-2 text-[var(--fs-xs)] text-gray-500 bg-amber-50 border-b border-amber-200">
        In the print dialog choose <strong>Scale 100%</strong> — not “Fit to page”, which resizes the label.
      </p>

      <div className="kw-scroll flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-center text-gray-400 py-16">Preparing labels…</p>
        ) : error ? (
          <p className="text-center text-red-600 py-16 font-semibold">{error}</p>
        ) : labels.length === 0 ? (
          <p className="text-center text-gray-400 py-16">No places yet — set them up first.</p>
        ) : (
          <div className="kw-sheet flex flex-wrap gap-4 justify-center">
            {labels.map((l) => {
              const off = skipped.has(l.id);
              return (
                <div key={l.id} className={off ? 'kw-no-print' : undefined}>
                  <div
                    className="kw-label bg-white border border-gray-300 rounded-sm shadow-sm relative overflow-hidden"
                    style={{ width: `${size.w}mm`, height: `${size.h}mm`, padding: `${Math.max(1.5, size.h * 0.06)}mm ${Math.max(2, size.w * 0.045)}mm` }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                      {l.branch && (
                        <div style={{
                          fontSize: `${branchMm(size.h)}mm`, fontWeight: 700, letterSpacing: '.01em',
                          color: '#444', textTransform: 'uppercase', lineHeight: 1.15,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{l.branch}</div>
                      )}
                      <div style={{
                        fontSize: `${nameMm(l.name, !!l.branch)}mm`, fontWeight: 900, letterSpacing: '-.02em',
                        lineHeight: .98, color: '#000', marginTop: '.4mm', overflowWrap: 'anywhere',
                      }}>{l.name}</div>
                      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', gap: `${size.w * 0.035}mm` }}>
                        {withQr && l.qr && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.qr} alt="" style={{ width: `${qrMm(size.h)}mm`, height: `${qrMm(size.h)}mm`, flex: '0 0 auto' }} />
                        )}
                        <span style={{
                          fontFamily: 'ui-monospace, Menlo, monospace', fontSize: `${smallMm(size.h)}mm`,
                          fontWeight: 700, color: '#333', lineHeight: 1.1,
                        }}>{l.code}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setSkipped((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                    className={`kw-no-print w-full mt-1.5 text-[11px] font-bold ${off ? 'text-green-700' : 'text-gray-400'} active:opacity-70`}>
                    {off ? 'Include this one' : 'Skip this one'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
