'use client';

/**
 * Counting a product that arrives NESTED — a box holds packs, a pack holds
 * pieces — with one stepper per level plus the loose ones.
 *
 * This is the same shape as CrateCountSheet, which stays the sheet for the
 * ordinary "one pack size + loose" products (89 of them today). A second sheet
 * rather than one generalised one is deliberate: the two-level sheet is used by
 * Quick Count and Goods Received as well, and widening it to N levels would
 * change three screens to serve a case none of them have.
 *
 * The totals shown here are for the person counting. The number that is SAVED
 * is computed again on the server from the chain frozen into this count, so
 * what the screen adds up and what the stock ledger receives cannot drift.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stepper, leafCategory } from './ui';
import NumpadModal from './NumpadModal';
import { packTotal, countableLevels, type PackLevel } from '@/lib/packaging';
import { pluralizePack, unitWords } from '@/lib/crate-units';

export interface PackCountSheetProps {
  open: boolean;
  product: { id: number; name: string; categ_id?: [number, string]; uom_id?: [number, string] } | null;
  levels: PackLevel[];
  uom: string;
  /** What ONE of them is called — "piece", "bun". Falls back to the Odoo unit. */
  looseLabel?: string | null;
  initialByLevel: Record<number, number>;
  initialLoose: number;
  locationName: string;
  showSystemQty: boolean;
  systemQty: number | null;
  onSave: (byLevel: Record<number, number>, loose: number) => void;
  onClose: () => void;
  outOfStock?: boolean;
  nothingHereLabel?: string;
  onNothingHere?: (on: boolean) => void;
  note?: string;
  onNoteChange?: (note: string) => void;
}

export default function PackCountSheet({
  open, product, levels, uom, looseLabel, initialByLevel, initialLoose,
  locationName, showSystemQty, systemQty, onSave, onClose,
  outOfStock, nothingHereLabel, onNothingHere, note, onNoteChange,
}: PackCountSheetProps) {
  const [byLevel, setByLevel] = useState<Record<number, number>>({});
  const [loose, setLoose] = useState(0);
  const [pad, setPad] = useState<null | number | 'loose'>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  // Seed the fields ONLY on the closed→open transition. The parent rebuilds
  // `initialByLevel` as a fresh object on every render (e.g. while typing a
  // note), so keying the reset off its identity wiped edits mid-count.
  const seedRef = useRef({ byLevel: initialByLevel, loose: initialLoose });
  seedRef.current = { byLevel: initialByLevel, loose: initialLoose };
  // What the fields held the moment the sheet opened — the baseline we compare
  // against to decide whether tapping away should COMMIT (a real change) or just
  // close. The prefill is a display-only reconstruction, so an untouched sheet
  // must never write it back or re-stamp who counted it.
  const openedSeed = useRef<{ byLevel: Record<number, number>; loose: number; note: string }>({ byLevel: {}, loose: 0, note: '' });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const seededBy = { ...(seedRef.current.byLevel || {}) };
      const seededLoose = seedRef.current.loose || 0;
      setByLevel(seededBy);
      setLoose(seededLoose);
      setPad(null);
      openedSeed.current = { byLevel: seededBy, loose: seededLoose, note: note || '' };
    }
    wasOpen.current = open;
  }, [open, note]);

  // Biggest first, so you count the way you look at a shelf: boxes, then packs,
  // then the ones rattling around loose.
  const countable = useMemo(
    () => countableLevels(levels).slice().sort((a, b) => b.toBase - a.toBase),
    [levels],
  );
  const words = unitWords(uom, undefined, looseLabel);
  const total = useMemo(() => packTotal({ byLevel, loose }, levels), [byLevel, loose, levels]);
  const catLeaf = leafCategory(product?.categ_id?.[1] || '');

  if (!open || !product) return null;

  const bump = (id: number, d: number) =>
    setByLevel((p) => ({ ...p, [id]: Math.max(0, (p[id] || 0) + d) }));
  const bumpLoose = (d: number) => setLoose((n) => Math.max(0, n + d));

  // Did a NUMBER actually change from what the sheet opened with? (Comparing
  // values, not "did they tap" — a minus at zero or a numpad-save of the same
  // number is a no-op and must not trigger a save of the display-only prefill.)
  const numbersChanged = (() => {
    const s = openedSeed.current;
    if ((loose || 0) !== (s.loose || 0)) return true;
    const seedBy = s.byLevel || {};
    // Check every level id present on either side; duplicate keys just re-check.
    const keys = [...Object.keys(byLevel), ...Object.keys(seedBy)];
    return keys.some((k) => (byLevel[+k] || 0) !== (seedBy[+k] || 0));
  })();
  // Tapping outside COMMITS what's entered — every plain +/- item on the count
  // saves the instant you tap it, and staff expected the same here (they lost
  // their bags + pieces). Commit only when a NUMBER actually changed, so an
  // untouched sheet is never re-saved, re-stamped, or turned into a phantom
  // zero. A note on its own isn't committed here (it saves with a count change
  // or via "Save"). "Cancel" always discards.
  const dismiss = () => {
    if (numbersChanged) onSave(byLevel, loose);
    else onClose();
  };

  const sum = [
    ...countable.map((l) => `(${byLevel[l.id] || 0} × ${l.toBase})`),
    String(loose),
  ].join(' + ');

  return (
    <div className="fixed inset-0 z-[110] flex items-end" role="dialog" aria-modal="true">
      <button aria-label="Save and close" onClick={dismiss} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full bg-gray-50 rounded-t-3xl max-h-[92vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="px-[18px] pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[var(--fs-lg)] font-bold text-gray-900 leading-snug [overflow-wrap:anywhere]">{product.name}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                {catLeaf ? `${catLeaf} · ` : ''}{locationName}
              </div>
            </div>
            {/* "Done" keeps what you entered (like tapping outside) — the count
                sticks without a Save button, consistent with every +/- item. */}
            <button onClick={dismiss} className="text-[var(--fs-sm)] font-bold text-green-700 active:opacity-70">Done</button>
          </div>

          {/* The chain itself, so what a box IS is never a guess. */}
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {countable.map((l) => (
              <span key={l.id} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                1 {l.name} = {l.toBase} {words.looseFor(l.toBase)}
              </span>
            ))}
          </div>

          {showSystemQty && (
            <div className="text-[var(--fs-sm)] text-gray-400 mt-2">
              System qty: <span className="font-mono font-medium text-gray-500">{systemQty ?? '--'}</span> {words.looseFor(2)}
            </div>
          )}
        </div>

        {countable.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 mx-[18px] mt-2">
            <div className="min-w-0">
              <div className="text-[var(--fs-md)] font-bold text-gray-900">Whole {pluralizePack(l.name, 2)}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 font-semibold mt-0.5">× {l.toBase} {words.looseFor(l.toBase)} each</div>
            </div>
            <Stepper value={byLevel[l.id] || 0} uom={pluralizePack(l.name, byLevel[l.id] || 0)}
              onMinus={() => bump(l.id, -1)} onPlus={() => bump(l.id, 1)} onTap={() => setPad(l.id)} />
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 mx-[18px] mt-2">
          <div className="min-w-0">
            <div className="text-[var(--fs-md)] font-bold text-gray-900">Loose {words.looseFor(2)}</div>
            <div className="text-[var(--fs-xs)] text-gray-500 font-semibold mt-0.5">
              not in {countable.length > 0 ? `a ${countable[countable.length - 1].name}` : 'a pack'}
            </div>
          </div>
          <Stepper value={loose} uom={words.looseFor(loose)}
            onMinus={() => bumpLoose(-1)} onPlus={() => bumpLoose(1)} onTap={() => setPad('loose')} />
        </div>

        <div className="mx-[18px] mt-4 bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
          <div className="text-[var(--fs-sm)] text-green-700 font-mono font-semibold [overflow-wrap:anywhere]">{sum}</div>
          <div className="text-[40px] leading-none font-extrabold font-mono text-green-700 mt-1.5">{total}</div>
          <div className="text-[var(--fs-sm)] text-green-700 font-bold mt-1">{words.looseFor(2)} total</div>
        </div>

        <div className="flex gap-2 items-start mx-[18px] mt-3.5 text-[var(--fs-xs)] text-gray-500 leading-snug">
          <span aria-hidden="true">💡</span>
          <span>
            Count the big ones first, then what is left over. A {countable[0]?.name || 'pack'} you have opened
            is not whole {'—'} count what is actually in it as loose.
          </span>
        </div>

        {onNoteChange && (
          <div className="mx-[18px] mt-3">
            {noteOpen || note ? (
              <textarea value={note || ''} onChange={(e) => onNoteChange(e.target.value)}
                placeholder="Anything the manager should know about this one"
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 min-h-[64px] text-[var(--fs-sm)] outline-none focus:border-green-600" />
            ) : (
              <button onClick={() => setNoteOpen(true)}
                className="text-[var(--fs-sm)] font-bold text-gray-500 active:opacity-70">📝 Add a note</button>
            )}
          </div>
        )}

        {/* No Save button: the count is kept the moment you leave (Done / tap
            outside), like every +/- item. "Nothing here" stays — it's the
            deliberate "none at this spot", not a counted number. */}
        {onNothingHere && (
          <div className="px-[18px] pt-4 pb-5">
            <button onClick={() => onNothingHere(!outOfStock)}
              className={`w-full h-12 rounded-xl border font-bold ${
                outOfStock ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'
              }`}>
              {outOfStock ? '✓ ' : ''}{nothingHereLabel || 'Nothing here'}
            </button>
          </div>
        )}
      </div>

      {pad !== null && (
        <NumpadModal
          open
          productName={pad === 'loose'
            ? `Loose ${words.looseFor(2)}`
            : `Whole ${pluralizePack(countable.find((l) => l.id === pad)?.name || 'pack', 2)}`}
          category={catLeaf}
          uom={pad === 'loose'
            ? words.looseFor(2)
            : pluralizePack(countable.find((l) => l.id === pad)?.name || 'pack', 2)}
          initialValue={pad === 'loose' ? loose : (byLevel[pad as number] || 0)}
          showSystemQty={false}
          systemQty={null}
          locationName={locationName}
          onSave={(v) => {
            const n = Math.max(0, Number(v) || 0);
            if (pad === 'loose') setLoose(n);
            else setByLevel((p) => ({ ...p, [pad as number]: n }));
            setPad(null);
          }}
          onClose={() => setPad(null)}
        />
      )}
    </div>
  );
}
