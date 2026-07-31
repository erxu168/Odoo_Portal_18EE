'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import OptionGrid from '@/components/ui/OptionGrid';
import { SearchBar, Spinner, EmptyState } from './ui';
import NumpadModal from './NumpadModal';
import CrateCountSheet from './CrateCountSheet';
import PhotoCaptureStrip from './PhotoCaptureStrip';
import WasteSettingsSheet from './WasteSettingsSheet';
import { useCompany } from '@/lib/company-context';
import { hasCrate, formatSplit, unitWords } from '@/lib/crate-units';

/**
 * The Waste Tracker — "Something binned". A cook, mid-service, one hand, ten
 * seconds: tap the product, tap the number, done. The third term of the
 * consumption equation (opening + purchases − waste − closing = used).
 *
 * The order of events is the design: the entry SAVES when the numpad closes.
 * The reason and the photo come after, on a screen you may simply walk away
 * from — anything that can block an entry is a reason people stop recording.
 * The one exception is a department whose manager switched "photo required"
 * on: there the save waits for the photo, and the screen says so.
 *
 * RAW STOCK ONLY. A binned cooked dish already left stock when it was cooked;
 * recording it here would subtract the same ingredients twice.
 */

interface WasteTrackerProps {
  userRole: string;
}

const REASONS = ['Gone off', 'Dropped', 'Burnt', 'Over-prepped', 'Wrong order'];

interface TodayEntry {
  id: number;
  odoo_product_id: number;
  qty_base: number;
  crate_qty: number | null;
  loose_qty: number | null;
  units_per_crate: number | null;
  uom: string;
  reason: string | null;
  wasted_by: number;
  wasted_by_name: string;
  wasted_at: string;
  has_photo: boolean;
}

/** "2 bags" / "1 crate + 3 bottles" / "0.5 kg" — the words it was typed in. */
function typedWords(e: { qty_base: number; crate_qty: number | null; loose_qty: number | null; units_per_crate: number | null; uom: string }, packLabel?: string, looseLabel?: string | null): string {
  const words = unitWords(e.uom, packLabel, looseLabel);
  if (e.crate_qty != null && hasCrate(e.units_per_crate)) {
    return formatSplit(e.crate_qty, e.loose_qty || 0, words.looseFor(e.loose_qty || 2), words.pack);
  }
  return `${e.qty_base} ${e.uom}`;
}

function timeHM(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  } catch { return ''; }
}

export default function WasteTracker({ userRole }: WasteTrackerProps) {
  const { companyId, loading: companyLoading } = useCompany();
  const [products, setProducts] = useState<any[]>([]);
  const [crateSizes, setCrateSizes] = useState<Record<number, number>>({});
  const [crateLabels, setCrateLabels] = useState<Record<number, string>>({});
  const [looseLabels, setLooseLabels] = useState<Record<number, string>>({});
  const [recent, setRecent] = useState<number[]>([]);
  const [today, setToday] = useState<TodayEntry[]>([]);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The entry in flight, across the numpad → (optional) why-screen → done card.
  const [sheet, setSheet] = useState<{ product: any } | null>(null);
  const [why, setWhy] = useState<{
    product: any;
    qty: { qty?: number; crate_qty?: number; loose_qty?: number; units_per_crate?: number };
    /** Set when the entry is ALREADY saved (the normal flow) — Done only annotates. */
    savedId: number | null;
    /** The idempotency key minted when the QUANTITY was captured — a retry of
     *  this same logical entry must reuse it, or the retry protection is
     *  theatre. */
    clientKey: string;
    reason: string | null;
    photos: string[];
    saving: boolean;
  } | null>(null);
  const [done, setDone] = useState<{ id: number; text: string; sub: string } | null>(null);
  /** Saves that FAILED, kept whole (same idempotency key each) so "Try again"
   *  re-sends the same logical entries — re-typing one would mint a new key,
   *  and if the first attempt actually landed, that would bin it twice. A
   *  QUEUE, not a single slot: during an outage a cook keeps working, and the
   *  second failure must not discard the first. */
  const [retryQueue, setRetryQueue] = useState<Array<{
    product: any;
    qty: { qty?: number; crate_qty?: number; loose_qty?: number; units_per_crate?: number };
    reason: string | null;
    photo: string | null;
    clientKey: string;
  }>>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Newest-request token: only the latest company's data may land. companyRef
  // guards MUTATION responses the same way — an old restaurant's POST must
  // never patch the newly selected restaurant's screen. Assigned during RENDER,
  // not in an effect: a response arriving between the render and an effect
  // would otherwise sneak through the one-frame-old value.
  const reqToken = useRef(0);
  const companyRef = useRef(companyId);
  companyRef.current = companyId;
  // A mutation epoch: bumped on every local mutation, so a slow refresh GET
  // from before a newer POST/undo can never overwrite the newer state.
  const wasteEpoch = useRef(0);
  useEffect(() => {
    // A half-entered entry belongs to the previous restaurant — drop it.
    setSheet(null); setWhy(null); setDone(null); setError(null); setRetryQueue([]);
  }, [companyId]);

  const isManager = userRole === 'manager' || userRole === 'admin';

  function mintKey(): string {
    return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const fetchAll = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    const token = ++reqToken.current;
    setLoading(true);
    try {
      const [prodRes, flagRes, wasteRes] = await Promise.all([
        fetch(`/api/inventory/products?company_id=${companyId}&relevant=1`).then((r) => r.json()),
        fetch('/api/inventory/product-flags').then((r) => r.json()),
        fetch(`/api/inventory/waste?company_id=${companyId}`).then((r) => r.json()),
      ]);
      if (token !== reqToken.current) return;
      setProducts((prodRes.products || []).filter((p: any) => p.active !== false));
      const crateMap: Record<number, number> = {};
      const labelMap: Record<number, string> = {};
      const looseMap: Record<number, string> = {};
      (flagRes.flags || []).forEach((f: any) => {
        if (f.units_per_crate != null && Number(f.units_per_crate) > 0) crateMap[f.odoo_product_id] = Number(f.units_per_crate);
        if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
        if (f.loose_label) looseMap[f.odoo_product_id] = f.loose_label;
      });
      setCrateSizes(crateMap);
      setCrateLabels(labelMap);
      setLooseLabels(looseMap);
      setRecent(wasteRes.recent || []);
      setToday(wasteRes.today || []);
      setPhotoRequired(!!wasteRes.photo_required);
    } catch {
      if (token === reqToken.current) setError('Could not load. Pull to retry.');
    } finally {
      if (token === reqToken.current) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current); }, []);

  /** Re-sync just the waste data (recents, today, photo rule) — after an Undo
   *  or a settings change, without reloading the whole product catalog. */
  const fetchWaste = useCallback(async () => {
    if (!companyId) return;
    const cid = companyId;
    const epoch = wasteEpoch.current;
    try {
      const d = await fetch(`/api/inventory/waste?company_id=${cid}`).then((r) => r.json());
      // Drop the snapshot if the restaurant changed OR anything mutated while
      // it was in flight — a pre-mutation snapshot must not undo a mutation.
      if (companyRef.current !== cid || wasteEpoch.current !== epoch) return;
      setRecent(d.recent || []);
      setToday(d.today || []);
      setPhotoRequired(!!d.photo_required);
    } catch { /* keep what we have — this is a refresh, not a load */ }
  }, [companyId]);

  const byId = useMemo(() => {
    const m: Record<number, any> = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const recentProducts = useMemo(
    () => recent.map((id) => byId[id]).filter(Boolean).slice(0, 8),
    [recent, byId],
  );

  const searched = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 30);
  }, [products, search]);

  /** The caption under a product name: the word staff count it in. */
  function unitCaption(p: any): string {
    const words = unitWords(p.uom_id?.[1] || 'Units', crateLabels[p.id], looseLabels[p.id]);
    return hasCrate(crateSizes[p.id]) ? `${words.pack}s` : words.loose;
  }

  function openProduct(p: any) {
    setSearch('');
    setSheet({ product: p });
  }

  /** The numpad closed with an amount. Save NOW — unless a photo must come first. */
  async function handleQuantity(product: any, q: { qty?: number; crate_qty?: number; loose_qty?: number; units_per_crate?: number }) {
    setSheet(null);
    const total = q.units_per_crate
      ? (q.crate_qty || 0) * q.units_per_crate + (q.loose_qty || 0)
      : (q.qty || 0);
    if (!(total > 0)) return;

    // The key belongs to this LOGICAL entry, minted once here — every retry of
    // it reuses the same key, so the server can answer a replay with the row
    // it already created instead of a second one.
    const clientKey = mintKey();
    if (photoRequired) {
      // The manager's switch: the save waits for the photo. Everything else
      // about the flow is unchanged.
      setWhy({ product, qty: q, savedId: null, clientKey, reason: null, photos: [], saving: false });
      return;
    }
    const id = await post(product, q, null, null, clientKey);
    if (id != null) {
      setWhy({ product, qty: q, savedId: id, clientKey, reason: null, photos: [], saving: false });
    }
  }

  async function post(product: any, q: { qty?: number; crate_qty?: number; loose_qty?: number; units_per_crate?: number }, reason: string | null, photo: string | null, clientKey: string): Promise<number | null> {
    setError(null);
    const cid = companyId;
    try {
      const res = await fetch(`/api/inventory/waste?company_id=${cid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: product.id,
          ...q,
          uom: product.uom_id?.[1] || 'Units',
          reason,
          photo,
          client_key: clientKey,
        }),
      });
      const d = await res.json();
      // The restaurant changed while this was in flight: the entry (if it
      // saved) belongs to the OLD one — nothing here may touch the new screen.
      if (companyRef.current !== cid) return null;
      if (!res.ok) {
        if (d.code === 'PHOTO_REQUIRED') {
          // The manager flipped the switch after this screen loaded. Keep the
          // typed quantity and ask for the photo instead of throwing it away.
          setPhotoRequired(true);
          setWhy({ product, qty: q, savedId: null, clientKey, reason, photos: [], saving: false });
          return null;
        }
        setError(d.error || 'Could not save — try again');
        setRetryQueue((prev) => prev.some((r) => r.clientKey === clientKey) ? prev : [...prev, { product, qty: q, reason, photo, clientKey }]);
        return null;
      }
      // Immediate feedback: the day list updates NOW, no refresh.
      wasteEpoch.current++;
      setRetryQueue((prev) => prev.filter((r) => r.clientKey !== clientKey));
      if (d.event) setToday((prev) => [d.event, ...prev.filter((e) => e.id !== d.event.id)]);
      setRecent((prev) => [product.id, ...prev.filter((id) => id !== product.id)].slice(0, 8));
      showDone(d.id, product, q, reason);
      return d.id as number;
    } catch {
      if (companyRef.current === cid) {
        // The truth is unknowable from here: the request may have died on the
        // way OUT (nothing saved) or on the way BACK (saved, response lost).
        // The kept key makes "Try again" safe either way — the server answers
        // a replay with the row it already has.
        setError('No connection — tap "Try again". It’s safe: the same entry can never be recorded twice.');
        setRetryQueue((prev) => prev.some((r) => r.clientKey === clientKey) ? prev : [...prev, { product, qty: q, reason, photo, clientKey }]);
      }
      return null;
    }
  }

  function showDone(id: number, product: any, q: { qty?: number; crate_qty?: number; loose_qty?: number; units_per_crate?: number }, reason: string | null) {
    const words = unitWords(product.uom_id?.[1] || 'Units', crateLabels[product.id], looseLabels[product.id]);
    const text = q.units_per_crate
      ? `${formatSplit(q.crate_qty || 0, q.loose_qty || 0, words.looseFor(q.loose_qty || 2), words.pack)} of ${product.name}`
      : `${q.qty} ${words.looseFor(q.qty || 2)} of ${product.name}`;
    const sub = [timeHM(new Date().toISOString()), reason?.toLowerCase()].filter(Boolean).join(' · ');
    setDone({ id, text, sub });
    if (doneTimer.current) clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDone(null), 4000);
  }

  /** Retry every failed entry, oldest first, each with its own original key. */
  async function retryAll() {
    setError(null);
    for (const r of retryQueue) {
      const id = await post(r.product, r.qty, r.reason, r.photo, r.clientKey);
      if (id == null) break;   // still failing — the rest would too
    }
  }

  /** Done on the why-screen: annotate the saved entry, or make the deferred save. */
  async function finishWhy() {
    if (!why || why.saving) return;
    setError(null);   // a stale failure notice must not outlive its retry
    const photo = why.photos[0] || null;
    if (why.savedId == null) {
      // photo-required flow: this IS the save.
      if (!photo) return;
      setWhy({ ...why, saving: true });
      const id = await post(why.product, why.qty, why.reason, photo, why.clientKey);
      // Only a SUCCESS closes the sheet. On failure the typed quantity, the
      // reason and the photo all stay put, ready to try again — post() has
      // already put the error on screen (and reuses the same key).
      if (id != null) setWhy(null);
      else setWhy((w) => (w ? { ...w, saving: false } : w));
    } else {
      const snapshot = why;
      const { savedId, reason } = snapshot;
      const cid = companyId;
      setWhy(null);
      if (reason || photo) {
        try {
          const res = await fetch('/api/inventory/waste', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: savedId, ...(reason ? { reason } : {}), ...(photo ? { photo } : {}) }),
          });
          if (companyRef.current !== cid) return;
          if (res.ok) {
            wasteEpoch.current++;
            setToday((prev) => prev.map((e) => e.id === savedId
              ? { ...e, reason: reason || e.reason, has_photo: e.has_photo || !!photo }
              : e));
            if (reason) setDone((d) => (d && d.id === savedId ? { ...d, sub: [d.sub.split(' · ')[0], reason.toLowerCase()].join(' · ') } : d));
          } else {
            // The ENTRY is safe either way — but a reason/photo the user tapped
            // "Done" on must not vanish: reopen the sheet with the draft intact.
            setError('Couldn’t save the reason/photo — the entry itself is safe. Try Done again.');
            setWhy({ ...snapshot, saving: false });
          }
        } catch {
          if (companyRef.current === cid) {
            setError('Couldn’t save the reason/photo — the entry itself is safe. Try Done again.');
            setWhy({ ...snapshot, saving: false });
          }
        }
      }
    }
  }

  async function undo(id: number) {
    setError(null);
    const cid = companyId;
    try {
      const res = await fetch(`/api/inventory/waste?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (companyRef.current !== cid) return;
      if (!res.ok) { setError(d.error || 'Could not undo'); return; }
      wasteEpoch.current++;
      setToday((prev) => prev.filter((e) => e.id !== id));
      setDone((prev) => (prev && prev.id === id ? null : prev));
      // Undoing may have been that product's only entry — let the server say
      // what "recently binned" means now, rather than guessing.
      void fetchWaste();
    } catch {
      if (companyRef.current === cid) setError('No connection — try again.');
    }
  }

  if (loading || companyLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Something binned" supertitle="Waste" />
        <Spinner />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Something binned" supertitle="Waste" />
        <div className="px-4 pt-6">
          <EmptyState title="No restaurant selected" body="Pick a restaurant in the top-right selector first." />
        </div>
      </div>
    );
  }

  const crateSize = sheet ? crateSizes[sheet.product.id] : undefined;

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <AppHeader
        title="Something binned"
        supertitle="Waste"
        action={isManager ? (
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Waste settings"
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        ) : undefined}
      />

      {/* The rule that keeps the numbers honest — always visible, never a popup. */}
      <div className="px-4 pt-3 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <span aria-hidden="true">🥕</span>
        <span><b className="text-gray-700">Raw ingredients only</b> — a binned cooked dish already left stock when it was cooked. Don&rsquo;t record it here.</span>
      </div>

      {photoRequired && (
        <div className="mx-4 mt-1 mb-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[var(--fs-xs)] font-semibold text-amber-800">
          📷 Your department requires a photo with every entry.
        </div>
      )}

      {(error || retryQueue.length > 0) && !why && (
        <div className="mx-4 mt-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-[var(--fs-sm)] font-semibold text-red-700">
            {retryQueue.length > 0
              ? `${retryQueue.length} entr${retryQueue.length === 1 ? 'y' : 'ies'} not saved yet${error ? ` — ${error}` : ''}`
              : error}
          </span>
          {retryQueue.length > 0 && (
            <button
              onClick={() => void retryAll()}
              className="mt-2 w-full min-h-[44px] rounded-xl bg-red-600 text-white text-[var(--fs-sm)] font-bold active:bg-red-700"
            >
              Try again
            </button>
          )}
        </div>
      )}

      <SearchBar value={search} onChange={setSearch} placeholder="Search what went in the bin..." />

      {search ? (
        <div className="px-4">
          {searched.length === 0 ? (
            <EmptyState title="Nothing found" body="Try another name. Only raw stock appears here." />
          ) : (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {searched.map((p) => (
                <ProductCell key={p.id} name={p.name} unit={unitCaption(p)} onClick={() => openProduct(p)} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="px-4">
          {recentProducts.length > 0 && (
            <>
              <p className="pt-2 pb-1.5 text-[10px] font-bold tracking-widest uppercase text-gray-400">Recently binned here</p>
              <div className="grid grid-cols-2 gap-2">
                {recentProducts.map((p) => (
                  <ProductCell key={p.id} name={p.name} unit={unitCaption(p)} onClick={() => openProduct(p)} />
                ))}
              </div>
            </>
          )}
          {recentProducts.length === 0 && (
            <EmptyState
              title="Nothing binned yet"
              body="When something raw goes in the bin — a bag gone off, a dropped crate — search it above and record it. Two taps."
            />
          )}
        </div>
      )}

      {/* Binned today — immediate proof it worked, and the Undo lives here too. */}
      {today.length > 0 && !search && (
        <div className="px-4 pt-5">
          <p className="pb-1.5 text-[10px] font-bold tracking-widest uppercase text-gray-400">Binned today</p>
          <div className="bg-white border border-gray-200 rounded-2xl px-3 divide-y divide-gray-100">
            {today.map((e) => {
              const p = byId[e.odoo_product_id];
              return (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">
                      {p?.name || `#${e.odoo_product_id}`}
                    </div>
                    <div className="text-[var(--fs-xs)] text-gray-500">
                      {typedWords(e, crateLabels[e.odoo_product_id], looseLabels[e.odoo_product_id])}
                      {e.reason ? ` · ${e.reason.toLowerCase()}` : ''}
                      {e.has_photo ? ' · 📷' : ''}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[var(--fs-xs)] text-gray-500">{e.wasted_by_name || ''}</div>
                    <div className="text-[var(--fs-xs)] font-mono text-gray-400">{timeHM(e.wasted_at)}</div>
                  </div>
                  <button
                    onClick={() => undo(e.id)}
                    className="flex-shrink-0 min-h-[44px] px-2.5 text-[var(--fs-xs)] font-bold text-red-600 active:opacity-60"
                  >
                    Undo
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quantity: the same two sheets counting uses — words staff already know. */}
      {sheet && hasCrate(crateSize) ? (
        <CrateCountSheet
          open
          product={sheet.product}
          unitsPerCrate={crateSize}
          uom={sheet.product.uom_id?.[1] || 'Units'}
          packLabel={unitWords(sheet.product.uom_id?.[1], crateLabels[sheet.product.id], looseLabels[sheet.product.id]).pack}
          looseLabel={looseLabels[sheet.product.id] || null}
          initialCrates={0}
          initialLoose={0}
          showSystemQty={false}
          systemQty={null}
          locationName="Waste"
          saveLabel="Bin it"
          onSave={(crates, loose) => handleQuantity(sheet.product, { crate_qty: crates, loose_qty: loose, units_per_crate: crateSize })}
          onClose={() => setSheet(null)}
        />
      ) : (
        <NumpadModal
          open={!!sheet}
          productName={sheet?.product?.name || ''}
          category={sheet?.product?.categ_id?.[1] || ''}
          uom={sheet?.product?.uom_id?.[1] || 'Units'}
          initialValue={null}
          showSystemQty={false}
          systemQty={null}
          locationName="Waste"
          saveLabel="Bin it"
          onSave={(v) => { if (sheet && v != null) handleQuantity(sheet.product, { qty: v }); else setSheet(null); }}
          onClose={() => setSheet(null)}
        />
      )}

      {/* Why? — optional when already saved; the save itself when a photo is required. */}
      {why && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-gray-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-[var(--fs-lg)] font-bold text-gray-900">
              {why.savedId != null ? 'Why? (optional)' : 'One more thing'}
            </span>
            <button
              onClick={() => setWhy(null)}
              aria-label="Close"
              className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-[var(--fs-sm)] font-semibold text-red-700">{error}</div>
            )}
            <p className="text-[var(--fs-sm)] text-gray-500 mb-2">{why.product.name}</p>
            <OptionGrid
              value={why.reason}
              options={REASONS.map((r) => ({ value: r, label: r }))}
              cols={2}
              ariaLabel="Reason"
              onChange={(v) => setWhy((w) => (w ? { ...w, reason: w.reason === v ? null : (v as string) } : w))}
            />
            <div className="mt-4">
              <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-1.5">
                Photo {why.savedId == null ? '(required)' : '(optional)'}
              </p>
              <PhotoCaptureStrip
                photos={why.photos}
                max={1}
                onChange={(photos) => setWhy((w) => (w ? { ...w, photos } : w))}
              />
            </div>
          </div>
          <div className="px-5 pb-6">
            <button
              onClick={finishWhy}
              disabled={why.saving || (why.savedId == null && why.photos.length === 0)}
              className="w-full h-14 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {why.saving ? 'Saving…' : why.savedId != null ? 'Done' : 'Bin it'}
            </button>
            {why.savedId != null && (
              <p className="text-center text-[var(--fs-xs)] text-gray-400 mt-2.5">
                or just walk away — it&rsquo;s already saved
              </p>
            )}
          </div>
        </div>
      )}

      {/* Binned — says what it recorded and offers the way back. */}
      {done && !why && (
        <div className="fixed left-4 right-4 bottom-6 z-[60]">
          <div className="bg-green-600 text-white rounded-2xl px-4 py-3.5 shadow-lg shadow-green-600/30 flex items-center gap-3">
            <span className="text-[22px]" aria-hidden="true">✓</span>
            <div className="min-w-0 flex-1">
              <div className="text-[var(--fs-sm)] font-bold truncate">{done.text}</div>
              {done.sub && <div className="text-[var(--fs-xs)] opacity-85">{done.sub}</div>}
            </div>
            <button
              onClick={() => undo(done.id)}
              className="flex-shrink-0 min-h-[44px] px-3 rounded-xl border border-white/40 text-[var(--fs-sm)] font-bold active:bg-white/15"
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <WasteSettingsSheet
          companyId={companyId}
          onClose={() => setSettingsOpen(false)}
          onSettled={() => void fetchWaste()}
        />
      )}
    </div>
  );
}

function ProductCell({ name, unit, onClick }: { name: string; unit: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[62px] text-left bg-white border border-gray-200 rounded-xl px-3 py-2.5 active:scale-[0.98] active:bg-gray-50 transition-transform"
    >
      <div className="text-[var(--fs-sm)] font-semibold text-gray-900 leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">{name}</div>
      <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{unit}</div>
    </button>
  );
}
