'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NumberField from '@/components/ui/NumberField';
import { useConfirm } from '@/components/ui/useConfirm';
import { pluralizePack, round2 } from '@/lib/crate-units';
import {
  eligibility, packOffer, needsPackClassification, trueCost, validate, MIN_TESTS_FOR_PACK,
  type YieldSummary, type YieldTest,
} from '@/lib/yield';
import { priceSourceLabel, type ResolvedPrice } from '@/lib/purchase-price';
import type { NumericValue } from '@/lib/numeric-input';

/**
 * YIELD & TRUE COST, on the product's own page.
 *
 * Ethan, 2026-08-07: "When I buy plantain the price is by kilo. However the kilo
 * I buy cannot be used because there is peel... I want to calculate the true
 * cost of the product... we probably need also the calculator."
 *
 * Three fields, because he asked for the piece count on 2026-08-08 — "let's have
 * staff enter how many pieces as well so that we know the average kg per piece."
 * That third number is what turns this from a costing tool into a counting fix:
 * `product_flags.units_per_crate` for a weight-based product IS kg-per-piece,
 * and today it is typed from memory.
 *
 * The section is deliberately quiet until it has something to say. A product
 * with no tests shows one line and a button; the summary, the true cost and the
 * pack-size offer each appear only when the data behind them exists.
 */

interface Flags {
  units_per_crate?: number | null;
  pack_label?: string | null;
  pack_varies?: boolean | null;
}

interface Props {
  product: { id: number; name: string; uom_id?: [number, string] };
  /**
   * The unit as the page currently has it, which is NOT always
   * `product.uom_id`: change kg to Units in the field above and the prop is
   * still the value the page loaded with. Deciding eligibility from the stale
   * one would leave the calculator open on a product that can no longer have a
   * yield test. (Codex, 2026-08-08.)
   */
  uomName?: string;
  /**
   * May this person record a measurement? Separate from `readOnly`, which
   * covers editing the PRODUCT. Weighing is a kitchen job; staff see this page
   * read-only and must still be able to do it.
   */
  canRecord?: boolean;
  /**
   * The page's own Cost field, used ONLY as a live override while it is being
   * edited — the resolved supplier price from the server is what is shown
   * otherwise, because almost no product here has a cost set.
   */
  standardPrice: string;
  flags: Flags | null;
  readOnly?: boolean;
  /** Tell the parent the pack size moved, so its own field re-renders. */
  onPackSizeChanged: (unitsPerCrate: number) => void;
}

/**
 * The pad reports a DRAFT while someone is still typing — "4." is a string, not
 * a number. Keep whatever it says in state (so the pad is never fought) and
 * coerce only where arithmetic happens; an incomplete draft is simply "nothing
 * yet".
 */
function num(v: NumericValue): number | null {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A key identifying ONE READING, so a retry cannot become a second measurement.
 *
 * It is the values plus a nonce, NOT a bare nonce. A bare nonce held across a
 * failed save has the opposite bug: if the request actually reached the server
 * and only the reply was lost, correcting a mistyped weight and saving again
 * would match the stored key and quietly return the ORIGINAL test — the
 * correction silently thrown away. Folding the numbers in means the same
 * reading dedupes and a changed one does not.
 */
function readingKey(nonce: string, raw: number | null, pieces: number | null, usable: number | null): string {
  return `${nonce}|${raw ?? ''}|${pieces ?? ''}|${usable ?? ''}`;
}

function newNonce(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older WebViews on the kitchen tablets have no randomUUID. Any distinct
    // string works; the server namespaces it by product before storing.
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const card = 'bg-white border border-gray-200 rounded-xl p-3';
const labelCls = 'block text-[var(--fs-xs)] font-bold text-gray-500 uppercase tracking-wide mb-1.5';

export default function YieldSection({
  product, uomName, standardPrice, flags, readOnly, canRecord, onPackSizeChanged,
}: Props) {
  const uom = (uomName || product.uom_id?.[1] || '').trim();
  const elig = useMemo(() => eligibility(uom), [uom]);

  const [tests, setTests] = useState<YieldTest[] | null>(null);
  const [summary, setSummary] = useState<YieldSummary | null>(null);
  const [resolved, setResolved] = useState<ResolvedPrice | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Local echo of the answer, so the card switches the instant it is tapped
  // instead of waiting for the parent to re-fetch the product's flags.
  const [variesLocal, setVariesLocal] = useState<boolean | null | undefined>(undefined);

  const [rawV, setRawV] = useState<NumericValue>(null);
  const [piecesV, setPiecesV] = useState<NumericValue>(null);
  const [usableV, setUsableV] = useState<NumericValue>(null);
  const raw = num(rawV);
  const pieces = num(piecesV);
  const usable = num(usableV);
  // Regenerated only after a save succeeds, so a retry of the SAME reading is
  // recognised as the same test — see readingKey for why the values matter too.
  const nonce = useRef(newNonce());

  const { confirm, confirmElement } = useConfirm();

  // Which product the newest request was for. ProductDetail is reused rather
  // than remounted in some flows, so without this a slow reply for product A
  // can paint its yield onto product B — and `variesLocal` would answer B's
  // "does it vary?" question with A's answer, permanently.
  const shownFor = useRef(product.id);

  const load = useCallback(async () => {
    const forId = product.id;
    try {
      const res = await fetch(`/api/inventory/yield/${forId}`);
      if (!res.ok || shownFor.current !== forId) return;
      const d = await res.json();
      if (shownFor.current !== forId) return;
      setTests(d.tests || []);
      setSummary(d.summary || null);
      setResolved(d.price || null);
    } catch { /* a missing history is not worth an error on a product page */ }
  }, [product.id]);

  useEffect(() => {
    shownFor.current = product.id;
    setTests(null); setSummary(null); setResolved(null);
    setVariesLocal(undefined); setError(null); setOpen(false); setShowAll(false);
    setRawV(null); setPiecesV(null); setUsableV(null);
    nonce.current = newNonce();
  }, [product.id]);

  useEffect(() => { if (elig.canTest) load(); }, [elig.canTest, load]);

  const packLabel = (flags?.pack_label || 'piece').trim() || 'piece';
  // The typed Cost wins ONLY while it is a real number being edited on this
  // page; otherwise the server's resolved price, which is usually the supplier's
  // — the Cost field is empty on all but a handful of products.
  const typed = standardPrice === '' ? null : Number(standardPrice);
  const price = typed && typed > 0 ? typed
    : (resolved && resolved.price > 0 ? resolved.price : null);
  const priceFrom = typed && typed > 0 ? 'the Cost above'
    : (resolved ? priceSourceLabel(resolved.source, resolved.supplier_name) : null);
  const cost = trueCost(price, summary?.fraction ?? null);

  const varies = variesLocal !== undefined ? variesLocal : (flags?.pack_varies ?? null);
  const offer = useMemo(
    () => (summary ? packOffer(uom, flags?.units_per_crate, summary, varies) : null),
    [summary, uom, flags?.units_per_crate, varies],
  );
  const mayRecord = canRecord ?? !readOnly;
  const askClassify = !!summary && !readOnly && needsPackClassification(uom, varies, summary);

  // A live warning while typing, so the two weights cannot be entered the wrong
  // way round and only rejected after the tap.
  const pending = raw != null && usable != null
    ? validate({ raw_qty: raw, usable_qty: usable, pieces })
    : null;
  const previewPct = raw != null && usable != null && raw > 0 && usable <= raw
    ? round2((usable / raw) * 100) : null;

  async function save() {
    if (raw == null || usable == null) { setError('Enter both weights.'); return; }
    const bad = validate({ raw_qty: raw, usable_qty: usable, pieces });
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inventory/yield/${product.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw_qty: raw, pieces, usable_qty: usable,
          client_key: readingKey(nonce.current, raw, pieces, usable),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'Could not save the test.'); return; }
      setTests(d.tests || []); setSummary(d.summary || null);
      nonce.current = newNonce();         // this reading is stored; the next is a new one
      setRawV(null); setPiecesV(null); setUsableV(null); setOpen(false);
    } catch { setError('Network error — the test was not saved.'); }
    finally { setBusy(false); }
  }

  async function remove(testId: number) {
    if (!await confirm({
      title: 'Remove this test?',
      message: 'The averages will be worked out again without it. This cannot be undone.',
      confirmLabel: 'Remove', variant: 'danger',
    })) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inventory/yield/${product.id}?test_id=${testId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'Could not remove it.'); return; }
      setTests(d.tests || []); setSummary(d.summary || null);
    } catch { setError('Network error — nothing was removed.'); }
    finally { setBusy(false); }
  }

  /** Answer "does one of these always weigh about the same?" — asked once. */
  async function classify(doesVary: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/inventory/product-flags/${product.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_varies: doesVary }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Could not save that.'); return;
      }
      setVariesLocal(doesVary);
    } catch { setError('Network error — not saved.'); }
    finally { setBusy(false); }
  }

  async function applyPackSize() {
    if (!offer) return;
    const measured = offer.measured;
    if (!await confirm({
      title: `Use ${measured} ${uom} per ${packLabel}?`,
      message: [
        offer.isFirst
          ? `Counts of this product will be converted with the measured figure from ${offer.tests} tests.`
          : `Every future count converts with ${measured} instead of ${offer.current}. `
            + 'Counts already taken keep the number they were recorded with.',
        // Pack size is one value per product, shared by every restaurant that
        // uses it — say so, rather than let a manager discover it later.
        'This pack size is shared by every restaurant that counts this product.',
        offer.wideSpread
          ? `Be careful: the tests ranged from ${offer.min} to ${offer.max} ${uom}, `
            + 'so one of these is not a reliable size.'
          : '',
      ].filter(Boolean).join(' '),
      confirmLabel: 'Use the measured size',
      variant: offer.wideSpread ? 'danger' : 'primary',
    })) return;
    setBusy(true); setError(null);
    try {
      // No number is sent: the server re-derives it from the stored tests and
      // re-checks every guard, so a stale screen cannot write a size nothing
      // measured. It also rescales pars in the same transaction.
      const res = await fetch(`/api/inventory/yield/${product.id}/apply-pack-size`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || 'Could not save the pack size.');
        if (res.status === 409) load();   // the screen is out of date — refresh it
        return;
      }
      onPackSizeChanged(d.units_per_crate ?? measured);
    } catch { setError('Network error — the pack size was not changed.'); }
    finally { setBusy(false); }
  }

  // Not weighed, so no ratio exists. Say why rather than hide the section — the
  // question "why can't I do a yield test here?" has one honest answer.
  if (!elig.canTest) {
    return (
      <div className="mb-4">
        <label className={labelCls}>Yield &amp; true cost</label>
        <div className={`${card} text-[var(--fs-xs)] text-gray-500`}>{elig.reason}</div>
      </div>
    );
  }

  const list = tests || [];
  const shown = showAll ? list : list.slice(0, 3);

  return (
    <div className="mb-4">
      <label className={labelCls}>Yield &amp; true cost</label>
      <div className={card}>

        {summary && summary.count > 0 ? (
          <>
            <div className="flex items-baseline gap-3">
              <div className="text-[28px] leading-none font-extrabold text-green-700 tabular-nums">
                {summary.pct}%
              </div>
              <div className="min-w-0 text-[var(--fs-xs)] text-gray-500">
                usable, from {summary.count} {summary.count === 1 ? 'test' : 'tests'}
              </div>
            </div>

            {cost != null && price != null && (
              <div className="mt-2.5 pt-2.5 border-t border-gray-100 text-[var(--fs-sm)]">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">You pay</span>
                  <span className="tabular-nums">&euro;{price.toFixed(2)} / {uom}</span>
                </div>
                <div className="flex justify-between gap-3 font-bold">
                  <span>The food you cook costs</span>
                  <span className="tabular-nums text-green-700">&euro;{cost.toFixed(2)} / {uom}</span>
                </div>
                {priceFrom && (
                  <p className="text-[var(--fs-xs)] text-gray-400 mt-1">from {priceFrom}</p>
                )}
              </div>
            )}
            {cost == null && (
              <p className="mt-2 text-[var(--fs-xs)] text-gray-400">
                {summary.fraction === 0
                  ? 'The tests found nothing usable at all, so there is no cost per usable '
                    + `${uom} to work out.`
                  : 'No buying price for this product yet, so there is nothing to work the '
                    + 'true cost out from.'}
              </p>
            )}

            {summary.perPieceRaw != null && (
              <div className="mt-2.5 pt-2.5 border-t border-gray-100 text-[var(--fs-sm)]">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">One {packLabel}, raw</span>
                  <span className="tabular-nums">{summary.perPieceRaw} {uom}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">One {packLabel}, usable</span>
                  <span className="tabular-nums">{summary.perPieceUsable} {uom}</span>
                </div>
                {summary.perPieceSpreadPct != null && summary.countWithPieces > 1 && (
                  <p className="text-[var(--fs-xs)] text-gray-400 mt-1">
                    {summary.perPieceMin}–{summary.perPieceMax} {uom} across
                    {' '}{summary.countWithPieces} {summary.countWithPieces === 1 ? 'test' : 'tests'}
                    {summary.perPieceSpreadPct > 25 ? ' — they vary a lot.' : '.'}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-[var(--fs-xs)] text-gray-500">
            Weigh a batch in and out to find out how much of it you can actually cook —
            and what that makes the real cost.
          </p>
        )}

        {/* THE ONE QUESTION the data cannot answer: is this pack size something
            that varies (a bunch) or something the supplier declares (a 10 kg
            bucket)? Asked once, only when there are finally enough tests for it
            to matter — and until it is answered nothing offers to change a
            pack size. Without it, three slightly-underfilled ketchup buckets
            would "prove" a 10 kg pack is really 9.85. */}
        {askClassify && (
          <div className="mt-3 rounded-xl border border-gray-300 bg-gray-50 p-3">
            <p className="text-[var(--fs-sm)] font-bold mb-1">
              Does one {packLabel} always weigh about the same?
            </p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-2.5">
              The tests measured {summary?.perPieceRaw} {uom} each. If that is a figure the
              supplier guarantees, leave it alone — if it is just roughly what one weighs,
              the tests can keep it accurate.
            </p>
            <div className="flex gap-2">
              <button onClick={() => classify(true)} disabled={busy}
                className="flex-1 h-11 rounded-xl bg-green-600 text-white font-bold active:bg-green-700 disabled:opacity-50">
                It varies
              </button>
              <button onClick={() => classify(false)} disabled={busy}
                className="flex-1 h-11 rounded-xl border border-gray-300 text-gray-600 font-semibold active:bg-gray-100 disabled:opacity-50">
                It&apos;s exact
              </button>
            </div>
          </div>
        )}

        {/* A pack the supplier declares: keep measuring the yield, never the
            size. Shown so the answer is visible and can be changed. */}
        {varies === false && !readOnly && summary && summary.countWithPieces > 0 && (
          <p className="mt-2.5 text-[var(--fs-xs)] text-gray-400">
            One {packLabel} is set to an exact {flags?.units_per_crate ?? '—'} {uom}, so the
            tests will not change it.{' '}
            <button onClick={() => classify(true)} disabled={busy}
              className="font-semibold text-green-700 underline">It actually varies</button>
          </p>
        )}

        {/* The pack-size offer. Only ever a suggestion; a manager confirms. */}
        {offer && !readOnly && (
          <div className="mt-3 rounded-xl border border-green-300 bg-green-50 p-3">
            <p className="text-[var(--fs-xs)] font-bold text-green-900 uppercase tracking-wide mb-1.5">
              {offer.isFirst ? 'Set the pack size from the tests' : 'The pack size looks wrong'}
            </p>
            {!offer.isFirst && (
              <div className="text-[var(--fs-sm)] mb-1.5">
                <div className="flex justify-between gap-3">
                  <span className="text-green-900/70">Typed in by hand</span>
                  <span className="tabular-nums line-through text-gray-500">{offer.current} {uom}</span>
                </div>
                <div className="flex justify-between gap-3 font-bold text-green-900">
                  <span>Measured, {offer.tests} tests</span>
                  <span className="tabular-nums">{offer.measured} {uom}</span>
                </div>
              </div>
            )}
            <p className="text-[var(--fs-xs)] text-green-900/80 mb-2.5">
              {offer.isFirst
                ? `${offer.tests} tests say one ${packLabel} is ${offer.measured} ${uom}. `
                  + `Set that and staff can count in ${pluralizePack(packLabel, 2)}.`
                : `Every count of this product has been about ${Math.abs(offer.offByPct || 0)}% `
                  + `${(offer.offByPct || 0) > 0 ? 'high' : 'low'} — not because anyone counted `
                  + `wrong, but because the conversion was a guess.`}
            </p>
            <button onClick={applyPackSize} disabled={busy}
              className="w-full h-11 rounded-xl bg-green-600 text-white font-bold active:bg-green-700 disabled:opacity-50">
              Use the measured {offer.measured} {uom}
            </button>
          </div>
        )}

        {/* Not enough evidence yet — say how much is missing rather than nothing. */}
        {!offer && varies !== false && summary && summary.countWithPieces > 0
          && summary.countWithPieces < MIN_TESTS_FOR_PACK && (
          <p className="mt-2.5 text-[var(--fs-xs)] text-gray-400">
            {MIN_TESTS_FOR_PACK - summary.countWithPieces} more{' '}
            {MIN_TESTS_FOR_PACK - summary.countWithPieces === 1 ? 'test' : 'tests'} with a piece
            count and the measured {packLabel} size can replace the typed one.
          </p>
        )}

        {error && (
          <p className="mt-2.5 text-[var(--fs-xs)] text-red-600" role="alert">{error}</p>
        )}

        {/* THE CALCULATOR — gated on canRecord, not readOnly: the page is
            read-only for staff, and weighing is exactly their job. */}
        {mayRecord && (open ? (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex flex-col gap-2.5">
              <div>
                <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">
                  Raw, as it arrived
                </div>
                <NumberField value={rawV} onValueChange={setRawV} onCommit={setRawV}
                  mode="decimal" allowEmpty min={0} fractionDigits={3} unit={uom}
                  aria-label="Raw weight" placeholder="0.000"
                  inputClassName="w-full h-12 px-3 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">
                  How many {pluralizePack(packLabel, 2)} <span className="font-normal text-gray-400">(optional)</span>
                </div>
                <NumberField value={piecesV} onValueChange={setPiecesV} onCommit={setPiecesV}
                  mode="integer" allowEmpty min={0}
                  aria-label={`How many ${pluralizePack(packLabel, 2)}`} placeholder="0"
                  inputClassName="w-full h-12 px-3 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <div className="text-[var(--fs-xs)] font-semibold text-gray-500 mb-1">
                  Usable after prep
                </div>
                <NumberField value={usableV} onValueChange={setUsableV} onCommit={setUsableV}
                  mode="decimal" allowEmpty min={0} fractionDigits={3} unit={uom}
                  aria-label="Usable weight" placeholder="0.000"
                  inputClassName="w-full h-12 px-3 border border-gray-300 rounded-xl" />
              </div>
            </div>

            {pending && (
              <p className="mt-2 text-[var(--fs-xs)] text-amber-700" role="alert">{pending}</p>
            )}
            {!pending && previewPct != null && (
              <p className="mt-2 text-[var(--fs-sm)] text-gray-600">
                <b className="text-green-700">{previewPct}%</b> usable
                {raw != null && usable != null && ` — ${round2(raw - usable)} ${uom} is waste`}
                {pieces ? `, ${round2(raw! / pieces)} ${uom} per ${packLabel}` : ''}
              </p>
            )}

            <div className="flex gap-2 mt-3">
              <button onClick={() => { setOpen(false); setError(null); }}
                className="h-11 px-4 rounded-xl border border-gray-300 text-gray-600 font-semibold">
                Cancel
              </button>
              <button onClick={save} disabled={busy || !!pending || raw == null || usable == null}
                className="flex-1 h-11 rounded-xl bg-green-600 text-white font-bold active:bg-green-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save this test'}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setOpen(true); setError(null); }}
            className="mt-3 w-full h-11 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">
            Record a yield test
          </button>
        ))}

        {/* HISTORY. Each row is a measurement somebody made; it can be removed
            but never edited, so the average always traces back to real readings. */}
        {list.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {shown.map((t) => (
              <div key={t.id} className="flex items-baseline gap-2 py-1.5 text-[var(--fs-xs)]">
                <span className="tabular-nums text-gray-500 shrink-0">
                  {(t.created_at || '').slice(0, 10)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {round2(t.raw_qty)} → {round2(t.usable_qty)} {uom}
                  {t.pieces ? ` · ${t.pieces} ${pluralizePack(packLabel, t.pieces)}` : ''}
                </span>
                <span className="tabular-nums font-bold shrink-0">
                  {t.raw_qty > 0 ? round2((t.usable_qty / t.raw_qty) * 100) : 0}%
                </span>
                {mayRecord && (
                  <button onClick={() => remove(t.id)} disabled={busy}
                    aria-label={`Remove the test from ${(t.created_at || '').slice(0, 10)}`}
                    className="shrink-0 w-8 h-8 -my-1 rounded-lg text-gray-400 active:bg-gray-100 disabled:opacity-40">
                    ×
                  </button>
                )}
              </div>
            ))}
            {list.length > 3 && (
              <button onClick={() => setShowAll(!showAll)}
                className="mt-1 text-[var(--fs-xs)] font-semibold text-green-700">
                {showAll ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmElement}
    </div>
  );
}
