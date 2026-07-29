'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState, ProductThumb } from './ui';
import StandardFilter from '@/components/ui/StandardFilter';
import RecordLink from '@/components/ui/RecordLink';
import PhotoLightbox from './PhotoLightbox';
import NumpadModal from './NumpadModal';
import { hasCrate, splitFromTotal, formatSplit, baseIsMeasure, unitWords, crateTotal } from '@/lib/crate-units';
import { typeIcon, typeLabel, LOCATION_TYPES } from '@/lib/location-types';

interface ReviewSubmissionsProps {
  onViewSession: (sessionId: number) => void;
}

export default function ReviewSubmissions({ onViewSession }: ReviewSubmissionsProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [quickCounts, setQuickCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('submitted');
  const [tab, setTab] = useState<'sessions' | 'quick'>('sessions');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [reviewSession, setReviewSession] = useState<any>(null);
  const [reviewProducts, setReviewProducts] = useState<any[]>([]);
  const [reviewEntries, setReviewEntries] = useState<any[]>([]);
  const [productImageIds, setProductImageIds] = useState<Set<number>>(new Set());
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState<'approve' | 'reject' | null>(null);
  // MULTI-SPOT review: the session's frozen lines + spot names + skipped stops,
  // and the manager's single-line correction modal.
  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const [reviewSpots, setReviewSpots] = useState<any[]>([]);
  const [reviewSkips, setReviewSkips] = useState<Record<number, string>>({});
  const [editLine, setEditLine] = useState<{ product: any; loc: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string } | null>(null);
  const [reviewQC, setReviewQC] = useState<any>(null);
  const [qcProduct, setQcProduct] = useState<any>(null);
  const [qcConfirm, setQcConfirm] = useState<'approve' | 'reject' | null>(null);
  const [draftDecisions, setDraftDecisions] = useState<Record<number, 'approved' | 'linked' | 'rejected'>>({});
  const [lightbox, setLightbox] = useState<{ open: boolean; photos: string[]; index: number }>({ open: false, photos: [], index: 0 });
  const [locations, setLocations] = useState<any[]>([]);
  const [dispMode, setDispMode] = useState<'split' | 'base'>('split');  // pack display toggle
  const [groupMode, setGroupMode] = useState<'product' | 'category' | 'type'>('product');  // review grouping: by product / product group / place
  // product_id -> what it came out at the last few APPROVED counts. Context only.
  const [reviewHistory, setReviewHistory] = useState<Record<number, { qty: number; date: string }[]>>({});
  const [reviewPackLabels, setReviewPackLabels] = useState<Record<number, string>>({});  // product_id -> whole-unit word
  const [reviewLooseLabels, setReviewLooseLabels] = useState<Record<number, string>>({}); // product_id -> single-unit word
  const [reviewQCLabel, setReviewQCLabel] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/inventory/locations')
      .then((r) => r.json())
      .then((d) => setLocations(d.locations || []))
      .catch(() => { /* non-fatal */ });
  }, []);

  // Products that have a picture — for the recognition thumbnail on each row.
  useEffect(() => {
    fetch('/api/inventory/product-images')
      .then((r) => r.ok ? r.json() : { with_images: [] })
      .then((d) => setProductImageIds(new Set<number>(d.with_images || [])))
      .catch(() => { /* thumbnails fall back to the placeholder */ });
  }, []);

  function locationName(id: number | null | undefined): string | null {
    if (id == null) return null;
    const loc = locations.find((l) => l.id === id);
    return loc?.complete_name || loc?.name || null;
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, qcRes] = await Promise.all([
        fetch(`/api/inventory/sessions?status=${filter}`).then((r) => r.json()),
        fetch(`/api/inventory/quick-count?status=${filter}`).then((r) => r.json()),
      ]);
      let sessData = sessRes.sessions || [];
      const qcData = qcRes.counts || [];

      if (dateRange && (filter === 'approved' || filter === 'rejected')) {
        sessData = sessData.filter((s: any) => {
          const d = (s.reviewed_at || s.scheduled_date || '').substring(0, 10);
          return d >= dateRange.from && d <= dateRange.to;
        });
      }

      setSessions(sessData);
      setQuickCounts(qcData);
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [reviewSystemQtys, setReviewSystemQtys] = useState<Record<number, number>>({});

  // ---- SESSION REVIEW ----
  async function openReview(sess: any) {
    setReviewLoading(true);
    setReviewSession(sess);
    setDraftDecisions({});
    setErrorMsg(null);
    try {
      const countRes = await fetch(`/api/inventory/counts?session_id=${sess.id}`).then(r => r.json());
      setReviewEntries(countRes.entries || []);
      setReviewSystemQtys(countRes.system_qtys || {});
      setReviewItems(countRes.items || []);
      setReviewSpots(countRes.spots || []);
      // Skipped stops (with reasons) — an uncounted line at a skipped spot shows WHY.
      try {
        const rt = await fetch(`/api/inventory/sessions/${sess.id}/route`).then(r => r.ok ? r.json() : null);
        const sk: Record<number, string> = {};
        (rt?.stops || []).forEach((st: any) => { if (st.status === 'skipped') sk[st.bucket_id] = st.skip_reason || 'skipped'; });
        setReviewSkips(sk);
      } catch { setReviewSkips({}); }

      // What these products came out at last time. Context for the reviewer —
      // never a flag, never an automatic change. Missing history is normal for a
      // young list, so a failure here just means no context is shown.
      try {
        const h = await fetch(`/api/inventory/sessions/${sess.id}/history`).then(r => r.ok ? r.json() : null);
        setReviewHistory(h?.history || {});
      } catch { setReviewHistory({}); }

      // Frozen snapshot decides the product set for modern sessions.
      let productIds: number[] = (countRes.items || []).length > 0
        ? Array.from(new Set<number>((countRes.items || []).map((it: any) => it.odoo_product_id)))
        : [];
      if (productIds.length === 0) {
        try { productIds = JSON.parse(sess.template_product_ids || '[]'); } catch { productIds = []; }
      }

      let productList: any[] = [];
      if (productIds.length > 0) {
        const prodRes = await fetch(`/api/inventory/products?ids=${productIds.join(',')}`).then(r => r.json());
        productList = prodRes.products || [];
      } else {
        let categoryIds: number[] = [];
        try { categoryIds = JSON.parse(sess.template_category_ids || '[]'); } catch { categoryIds = []; }
        if (categoryIds.length > 0) {
          const promises = categoryIds.map(cid => fetch(`/api/inventory/products?category_id=${cid}&include_pos=1`).then(r => r.json()));
          const results = await Promise.all(promises);
          const seen = new Set<number>();
          results.forEach(r => (r.products || []).forEach((p: any) => { if (!seen.has(p.id)) { seen.add(p.id); productList.push(p); } }));
        }
      }

      // Pull in any products referenced by count entries that aren't yet
      // loaded — these may be draft products created on-the-fly via
      // scan-to-count.
      const entryProductIds: number[] = (countRes.entries || []).map((e: any) => e.product_id);
      const haveIds = new Set(productList.map((p: any) => p.id));
      const missingIds = entryProductIds.filter((id: number) => !haveIds.has(id));
      if (missingIds.length > 0) {
        const extra = await fetch(`/api/inventory/products?ids=${missingIds.join(',')}`).then(r => r.json());
        productList.push(...(extra.products || []));
      }
      setReviewProducts(productList);

      // Pack labels aren't snapshotted on count rows — fetch current per-product labels.
      try {
        const ids = productList.map((p: any) => p.id).filter(Boolean);
        const labelMap: Record<number, string> = {};
        const looseMap: Record<number, string> = {};
        if (ids.length > 0) {
          const flagRes = await fetch(`/api/inventory/product-flags?ids=${ids.join(',')}`).then(r => r.json());
          (flagRes.flags || []).forEach((f: any) => {
            if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
            if (f.loose_label) looseMap[f.odoo_product_id] = f.loose_label;
          });
        }
        setReviewPackLabels(labelMap);
        setReviewLooseLabels(looseMap);
      } catch { setReviewPackLabels({}); setReviewLooseLabels({}); }
    } catch (err) {
      console.error('Failed to load review data:', err);
    } finally {
      setReviewLoading(false);
    }
  }

  // Manager single-line correction on a SUBMITTED count (attributed + noted
  // server-side). Updates the local entry list so totals re-derive instantly.
  async function saveLineEdit(v: number | null) {
    const target = editLine;
    setEditLine(null);
    if (!target || v == null || !reviewSession) return;
    const uom = target.product.uom_id?.[1] || 'Units';
    try {
      const res = await fetch('/api/inventory/counts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: reviewSession.id, product_id: target.product.id, count_location_id: target.loc, counted_qty: v, uom }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErrorMsg(d.error || 'Could not save the correction.'); return; }
      setReviewEntries((prev: any[]) => {
        const idx = prev.findIndex((e) => e.product_id === target.product.id && (e.count_location_id ?? 0) === target.loc);
        const row = { ...(idx >= 0 ? prev[idx] : { product_id: target.product.id, count_location_id: target.loc, photos: [] }), counted_qty: v, out_of_stock: 0, manager_note: 'Manager correction' };
        if (idx >= 0) { const n = [...prev]; n[idx] = row; return n; }
        return [...prev, row];
      });
    } catch { setErrorMsg('Network error \u2014 correction not saved.'); }
  }

  async function handleSessionAction(action: 'approve' | 'reject') {
    if (!reviewSession) return;
    setActionLoading(reviewSession.id);
    setErrorMsg(null);
    try {
      let res: Response;
      if (action === 'approve') {
        res = await fetch('/api/inventory/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: reviewSession.id }) });
      } else {
        res = await fetch('/api/inventory/sessions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reviewSession.id, status: 'rejected' }) });
      }
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || 'Action failed'); setShowConfirm(null); return; }
      // Products the count could not find: approval deliberately left their
      // stock untouched. The server has always returned them; nobody was told.
      // Said FIRST, because "these were not updated" matters more to a manager
      // than any sync note that follows it.
      const nf: number[] = Array.isArray(data.not_found_products) ? data.not_found_products : [];
      if (nf.length > 0) {
        const names = nf
          .map((id) => reviewProducts.find((p: any) => p.id === id)?.name || `#${id}`)
          .slice(0, 6);
        const more = nf.length > names.length ? ` and ${nf.length - names.length} more` : '';
        setErrorMsg(
          `Approved. ${nf.length} product${nf.length === 1 ? '' : 's'} could not be found, so `
          + `${nf.length === 1 ? 'its' : 'their'} stock was left unchanged: ${names.join(', ')}${more}.`
          + `${data.warning ? ` (${data.warning})` : ''}`,
        );
      } else if (data.warning) setErrorMsg(data.warning);
      setShowConfirm(null);
      setReviewSession(null);
      setReviewProducts([]);
      setReviewEntries([]);
      setReviewHistory({});
      fetchData();
    } catch (err) {
      console.error(`${action} failed:`, err);
      setErrorMsg('Network error. Please try again.');
      setShowConfirm(null);
    } finally {
      setActionLoading(null);
    }
  }

  // ---- QUICK COUNT REVIEW ----
  async function openQCReview(qc: any) {
    setReviewQC(qc);
    setQcProduct(null);
    setReviewQCLabel(null);
    setErrorMsg(null);
    try {
      const prodRes = await fetch(`/api/inventory/products?ids=${qc.product_id}`).then(r => r.json());
      const products = prodRes.products || [];
      setQcProduct(products.length > 0 ? products[0] : null);
      try {
        const flagRes = await fetch(`/api/inventory/product-flags?ids=${qc.product_id}`).then(r => r.json());
        setReviewQCLabel((flagRes.flags || [])[0]?.pack_label || null);
      } catch { setReviewQCLabel(null); }
    } catch (err) {
      console.error('Failed to load QC product:', err);
    }
  }

  async function handleQCAction(action: 'approve' | 'reject') {
    if (!reviewQC) return;
    setActionLoading(reviewQC.id);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/inventory/quick-count/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reviewQC.id, action }) });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || 'Action failed'); setQcConfirm(null); return; }
      if (data.warning) setErrorMsg(data.warning);
      setQcConfirm(null);
      setReviewQC(null);
      setQcProduct(null);
      fetchData();
    } catch (err) {
      console.error('QC action failed:', err);
      setErrorMsg('Network error. Please try again.');
      setQcConfirm(null);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRecount(sessionId: number) {
    setActionLoading(sessionId);
    try {
      const res = await fetch('/api/inventory/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'pending' }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || 'Failed to reopen session'); return; }
      fetchData();
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  const pendingSessions = sessions.filter((s) => s.status === 'submitted').length;
  const pendingQC = quickCounts.filter((q) => q.status === 'pending').length;
  const showDateFilter = filter === 'approved' || filter === 'rejected';

  // ======== QUICK COUNT DETAIL VIEW ========
  if (reviewQC) {
    const isPending = reviewQC.status === 'pending';
    const productName = qcProduct?.name || `Product #${reviewQC.product_id}`;
    const uom = qcProduct?.uom_id?.[1] || reviewQC.uom || 'Units';
    const catName = qcProduct?.categ_id?.[1] || '';
    const qcIsCrate = hasCrate(reviewQC.units_per_crate);
    const qcSplit = qcIsCrate
      ? ((reviewQC.crate_qty != null || reviewQC.loose_qty != null)
          ? { crates: Number(reviewQC.crate_qty) || 0, loose: Number(reviewQC.loose_qty) || 0 }
          : splitFromTotal(reviewQC.counted_qty, reviewQC.units_per_crate))
      : null;
    const submittedDate = reviewQC.submitted_at ? new Date(reviewQC.submitted_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => { setReviewQC(null); setQcProduct(null); setErrorMsg(null); }}
              className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Back to list
            </button>
          </div>
          <h1 className="text-[18px] font-bold text-gray-900">Review quick count</h1>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-0.5">Submitted {submittedDate} {'\u00B7'} by {reviewQC.counted_by_name || `User #${reviewQC.counted_by}`}</p>
        </div>

        {errorMsg && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[var(--fs-sm)] font-semibold">{errorMsg}</div>
        )}

        <div className="px-4 pt-4 flex-1">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-xl)] font-bold text-gray-900 truncate">{productName}</div>
                {catName && <div className="text-[var(--fs-xs)] text-gray-400">{catName}</div>}
              </div>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="flex-1 bg-green-50 rounded-xl p-4 text-center">
                <div className="text-[28px] font-bold text-green-700 font-mono">{reviewQC.counted_qty}</div>
                <div className="text-[var(--fs-xs)] text-green-600 font-semibold">{uom} counted</div>
                {qcIsCrate && qcSplit && (
                  <div className="text-[var(--fs-xs)] text-green-700 mt-1 font-mono">
                    = {formatSplit(qcSplit.crates, qcSplit.loose, uom, reviewQCLabel ?? (baseIsMeasure(uom) ? 'piece' : 'crate'))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 text-[var(--fs-sm)] text-gray-500">
              <div className="flex justify-between"><span>Location</span><span className="font-semibold text-gray-700">{locationName(reviewQC.location_id) || `ID #${reviewQC.location_id}`}</span></div>
              <div className="flex justify-between"><span>Counted by</span><span className="font-semibold text-gray-700">{reviewQC.counted_by_name || `User #${reviewQC.counted_by}`}</span></div>
              <div className="flex justify-between"><span>Submitted</span><span className="font-semibold text-gray-700">{submittedDate}</span></div>
            </div>
          </div>
        </div>

        {isPending && (
          <div className="px-4 py-3">
            <div className="flex gap-3">
              <button onClick={() => setQcConfirm('reject')}
                className="py-3.5 px-6 rounded-xl border border-red-200 text-red-600 text-[14px] font-bold active:bg-red-50">
                Reject
              </button>
              <button onClick={() => setQcConfirm('approve')}
                className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
                Approve
              </button>
            </div>
          </div>
        )}

        {qcConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
            <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
              <h3 className="text-[17px] font-bold text-gray-900 mb-2">
                {qcConfirm === 'approve' ? 'Approve this quick count?' : 'Reject this quick count?'}
              </h3>
              <p className="text-[var(--fs-base)] text-gray-500 mb-5">
                {qcConfirm === 'approve'
                  ? `This will set ${productName} to ${reviewQC.counted_qty} ${uom} in Odoo.`
                  : 'This quick count will be discarded.'}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setQcConfirm(null)}
                  className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[14px] font-semibold active:bg-gray-200">
                  Cancel
                </button>
                <button onClick={() => handleQCAction(qcConfirm)} disabled={actionLoading !== null}
                  className={`flex-1 py-3.5 rounded-xl text-white text-[14px] font-bold disabled:opacity-50 ${
                    qcConfirm === 'approve'
                      ? 'bg-green-600 shadow-lg shadow-green-600/30 active:bg-green-700'
                      : 'bg-red-500 shadow-lg shadow-red-500/30 active:bg-red-600'
                  }`}>
                  {actionLoading !== null ? '...' : qcConfirm === 'approve' ? 'Yes, approve' : 'Yes, reject'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ======== SESSION DETAIL VIEW ========
  if (reviewSession) {
    // Product-level value = the SUM of its spot lines (multi-spot).
    const entryMap: Record<number, number> = {};
    const entryByProduct: Record<number, any> = {};
    reviewEntries.forEach((e: any) => {
      entryMap[e.product_id] = (entryMap[e.product_id] || 0) + (Number(e.counted_qty) || 0);
      entryByProduct[e.product_id] = e;
    });
    const hasSpotLayout = reviewItems.some((it: any) => it.count_location_id !== 0);
    const spotName = (loc: number) => loc === 0 ? 'General' : (reviewSpots.find((sp: any) => sp.count_location_id === loc)?.name || `Spot ${loc}`);
    const snapshotLinesOf: Record<number, number[]> = {};
    reviewItems.forEach((it: any) => { (snapshotLinesOf[it.odoo_product_id] ||= []).push(it.count_location_id); });
    const hasAnyCrate = reviewEntries.some((e: any) => hasCrate(e.units_per_crate));
    // Out of stock = counted, but every entry (a product may sit at several spots)
    // is the explicit out-of-stock zero. These stay in the counted list (so a
    // draft keeps its review panel and any photos still render) with an
    // out-of-stock badge; only the summary tallies them separately.
    const entriesByProduct: Record<number, any[]> = {};
    reviewEntries.forEach((e: any) => { (entriesByProduct[e.product_id] ||= []).push(e); });
    const isOutOfStock = (pid: number) => {
      const es = entriesByProduct[pid];
      return !!es && es.length > 0 && es.every((e: any) => e.out_of_stock);
    };
    // ANY not-found line makes the product's total unknown — approval leaves its
    // stock untouched, so showing the sum of the spots that WERE found would be
    // a number the manager thinks is complete and is not.
    const isNotFound = (pid: number) => (entriesByProduct[pid] || []).some((e: any) => e.not_found);
    const countedProducts = reviewProducts.filter(p => entryMap[p.id] !== undefined);
    const uncountedProducts = reviewProducts.filter(p => entryMap[p.id] === undefined);
    // PARTIAL: counted somewhere, but at least one of its frozen spot lines has
    // no entry — the total is understated and must never look complete.
    const partialProducts = countedProducts.filter((p: any) => {
      const want = snapshotLinesOf[p.id]?.length || 0;
      const have = (entriesByProduct[p.id] || []).length;
      return want > have;
    });
    const outOfStockCount = countedProducts.filter(p => isOutOfStock(p.id)).length;
    const trueCountedCount = countedProducts.length - outOfStockCount;
    const addressedCount = countedProducts.length; // everything the staffer resolved (counted or out-of-stock)
    // NEEDS YOUR EYE: the places this count did not settle. Only facts go in
    // here — a spot the staffer skipped (with their reason) and a spot nobody
    // opened. No guessing at "unusual" numbers; the past counts are shown as
    // plain context on the line instead.
    const attention: { product: any; loc: number; kind: 'skipped' | 'missed'; where: string; why: string | null }[] = [];
    reviewProducts.forEach((p: any) => {
      const locs = snapshotLinesOf[p.id] || [];
      if (locs.length === 0) {
        // A legacy count has no per-spot lines to walk. Judging it by those
        // lines would find nothing missing and cheerfully report "everything
        // was counted" over a list nobody touched, so fall back to the product.
        if ((entriesByProduct[p.id] || []).length === 0) {
          attention.push({ product: p, loc: 0, kind: 'missed', where: '', why: null });
        }
        return;
      }
      locs.forEach((loc: number) => {
        const has = (entriesByProduct[p.id] || []).some((e: any) => (e.count_location_id ?? 0) === loc);
        if (has) return;
        const why = reviewSkips[loc];
        attention.push({
          product: p,
          loc,
          kind: why ? 'skipped' : 'missed',
          where: spotName(loc),
          why: why || null,
        });
      });
    });

    // BY GROUP: the leaf category a cook would name ("Herbs & Greens"), with the
    // path above it kept as context so two "Sauces" stay distinguishable.
    const catBuckets = new Map<string, { name: string; parent: string; products: any[] }>();
    reviewProducts.forEach((p: any) => {
      const full = p.categ_id?.[1] || 'Other';
      const parts = String(full).split('/').map((x: string) => x.trim()).filter(Boolean);
      const name = parts[parts.length - 1] || 'Other';
      const parent = parts.slice(0, -1).join(' \u203A ');
      const key = String(full);
      if (!catBuckets.has(key)) catBuckets.set(key, { name, parent, products: [] });
      catBuckets.get(key)!.products.push(p);
    });
    // "Left" means every line of it is in, not merely that someone touched it —
    // a product counted in one of its two fridges is still unfinished, and a
    // group calling itself "all counted" over one of those is a lie.
    const isFullyCounted = (p: any) => {
      if (entryMap[p.id] === undefined) return false;
      const want = snapshotLinesOf[p.id]?.length || 0;
      return want === 0 || (entriesByProduct[p.id] || []).length >= want;
    };
    const categoryGroups = Array.from(catBuckets.entries())
      .map(([path, g]) => ({ ...g, path, left: g.products.filter((p: any) => !isFullyCounted(p)).length }))
      .sort((a, b) => (b.left > 0 ? 1 : 0) - (a.left > 0 ? 1 : 0) || a.name.localeCompare(b.name));

    const isSubmitted = reviewSession.status === 'submitted';
    const hasUnresolvedDrafts = countedProducts.some((p: any) => p.is_draft && !draftDecisions[p.id]);

    // BY LOCATION TYPE: sum every counted line into the TYPE (kind) of the spot
    // it was counted in — a read-only "total across all fridges / freezers / …".
    const locKind = (loc: number) => loc === 0 ? '' : (locations.find((l: any) => l.id === loc)?.kind || '');
    const byType: Record<string, { qty: number; products: Record<number, number> }> = {};
    reviewEntries.forEach((e: any) => {
      const key = locKind(e.count_location_id ?? 0) || 'general';
      const qty = Number(e.counted_qty) || 0;
      (byType[key] ||= { qty: 0, products: {} });
      byType[key].qty += qty;
      byType[key].products[e.product_id] = (byType[key].products[e.product_id] || 0) + qty;
    });
    const typeOrder = [...LOCATION_TYPES.map(t => t.key), 'general'];
    const typeGroups = Object.keys(byType).sort((a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b));

    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => { setReviewSession(null); setReviewProducts([]); setReviewEntries([]); setReviewHistory({}); setErrorMsg(null); }}
              className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Back to list
            </button>
          </div>
          <h1 className="text-[18px] font-bold text-gray-900">{reviewSession.template_name || `Session #${reviewSession.id}`}</h1>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
            {[
              reviewSession.scheduled_date,
              locationName(reviewSession.location_id),
              reviewSession.assigned_user_id != null
                ? `Counted by ${reviewSession.assigned_user_name || `user #${reviewSession.assigned_user_id}`}`
                : null,
            ].filter(Boolean).join(' \u00B7 ')}
          </p>
        </div>

        {errorMsg && (
          <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[var(--fs-sm)] font-semibold">{errorMsg}</div>
        )}

        {reviewLoading ? <Spinner /> : (
          <>
            <div className="px-4 pt-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[var(--fs-base)] font-bold text-gray-900">Count summary</span>
                  <span className="text-[var(--fs-sm)] font-mono text-gray-500">{addressedCount}/{reviewProducts.length}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div className={`h-full rounded-full ${addressedCount === reviewProducts.length ? 'bg-green-500' : 'bg-amber-500'}`}
                    style={{ width: `${reviewProducts.length > 0 ? (addressedCount / reviewProducts.length) * 100 : 0}%` }} />
                </div>
                <div className="flex gap-2.5">
                  <div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                    <div className="text-[20px] font-bold text-green-700 font-mono">{trueCountedCount}</div>
                    <div className="text-[var(--fs-xs)] text-green-600 font-semibold">Counted</div>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-xl p-3 text-center">
                    <div className="text-[20px] font-bold text-red-700 font-mono">{outOfStockCount}</div>
                    <div className="text-[var(--fs-xs)] text-red-600 font-semibold">Out of stock</div>
                  </div>
                  <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                    <div className="text-[20px] font-bold text-amber-700 font-mono">{uncountedProducts.length}</div>
                    <div className="text-[var(--fs-xs)] text-amber-600 font-semibold">Not counted</div>
                  </div>
                </div>
              </div>
            </div>

            {/* What staff wanted the manager to know about the whole count. It is
                the reason a place is empty ("basement was locked") — useless if
                it only lives in the database. */}
            {reviewSession.staff_note && (
              <div className="px-4 pt-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <div className="text-[var(--fs-xs)] font-bold text-blue-700 uppercase tracking-wide mb-1">
                    Note from the person counting
                  </div>
                  <p className="text-[var(--fs-sm)] text-blue-900 whitespace-pre-wrap break-words">{reviewSession.staff_note}</p>
                </div>
              </div>
            )}

            {hasAnyCrate && (
              <div className="px-4 pt-1">
                <div className="flex bg-gray-100 rounded-xl p-1" role="group" aria-label="Display units">
                  <button onClick={() => setDispMode('split')}
                    className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-all ${dispMode === 'split' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    Packs + units
                  </button>
                  <button onClick={() => setDispMode('base')}
                    className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-all ${dispMode === 'base' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    Units only
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-36">
              {/* PROBLEMS FIRST. A reviewer opens this screen to answer one
                  question — is anything wrong? — so the unsettled lines come
                  before the 200 that are fine. */}
              <div className="mt-3">
                <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">Needs your eye</p>
                {attention.length === 0 ? (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2">
                    <span aria-hidden="true">{'\u2713'}</span>
                    <span className="text-[var(--fs-sm)] font-semibold text-green-800">Everything was counted {'\u2014'} nothing was skipped or missed.</span>
                  </div>
                ) : (
                  <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
                    {attention.map((a, i) => (
                      <div key={`${a.product.id}-${a.loc}-${i}`}
                        className="flex items-center gap-3 px-3 py-2.5 border-b border-amber-50 last:border-b-0">
                        <span className={`w-1.5 self-stretch rounded-full flex-shrink-0 ${a.kind === 'skipped' ? 'bg-orange-400' : 'bg-amber-400'}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{a.product.name}</div>
                          <div className="text-[var(--fs-xs)] text-gray-600">
                            {a.kind === 'skipped'
                              ? <><span className="font-semibold">{a.where}</span> was skipped {'\u2014'} {'\u201C'}{a.why}{'\u201D'}</>
                              : a.where
                                ? <><span className="font-semibold">{a.where}</span> was never counted</>
                                : 'Never counted'}
                          </div>
                        </div>
                        {isSubmitted && (
                          <button onClick={() => setEditLine({ product: a.product, loc: a.loc })}
                            className="flex-shrink-0 text-[var(--fs-xs)] font-bold text-blue-700 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 active:bg-blue-100">
                            Fix
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* One count, three ways to read it: line by line, by the groups the
                  kitchen thinks in, or by where things physically live. */}
              <div className="flex bg-gray-100 rounded-xl p-1 mt-4 mb-1" role="group" aria-label="Group the count by">
                <button onClick={() => setGroupMode('product')}
                  className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-all ${groupMode === 'product' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By product</button>
                <button onClick={() => setGroupMode('category')}
                  className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-all ${groupMode === 'category' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By group</button>
                <button onClick={() => setGroupMode('type')}
                  className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition-all ${groupMode === 'type' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>By place</button>
              </div>
              {groupMode === 'category' ? (
                <div className="mt-2">
                  {categoryGroups.length === 0 ? (
                    <p className="text-center text-gray-400 text-[var(--fs-sm)] py-8">Nothing in this count yet.</p>
                  ) : categoryGroups.map((g) => (
                    <div key={g.path} className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--fs-base)] font-extrabold text-gray-900 truncate">{g.name}</span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${
                            g.left === 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {g.left === 0 ? 'all counted' : `${g.left} left`}
                          </span>
                        </div>
                        <span className="text-[var(--fs-xs)] text-gray-500">
                          {g.parent ? `${g.parent} \u00B7 ` : ''}{g.products.length} product{g.products.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {g.products.map((p: any) => {
                        const v = entryMap[p.id];
                        const uom = p.uom_id?.[1] || 'Units';
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-50 last:border-b-0">
                            <span className="text-[var(--fs-base)] text-gray-800 truncate min-w-0">{p.name}</span>
                            {v === undefined ? (
                              <span className="text-[var(--fs-xs)] font-semibold text-amber-700 flex-shrink-0">not counted</span>
                            ) : !isFullyCounted(p) ? (
                              <span className="flex items-baseline gap-1.5 flex-shrink-0">
                                <span className="font-mono font-semibold text-gray-900">{v} {p.uom_id?.[1] || 'Units'}</span>
                                <span className="text-[var(--fs-xs)] font-semibold text-amber-700">partial</span>
                              </span>
                            ) : isOutOfStock(p.id) ? (
                              <span className="text-[var(--fs-xs)] font-semibold text-red-600 flex-shrink-0">none left</span>
                            ) : isNotFound(p.id) ? (
                              // Deliberately NOT the sum. Stock is left untouched
                              // for this product, so a number here would read as
                              // a complete count when it is not.
                              <span className="flex items-baseline gap-1.5 flex-shrink-0">
                                {v > 0 && <span className="font-mono text-gray-500">{v} {uom} found</span>}
                                <span className="text-[var(--fs-xs)] font-semibold text-amber-700">couldn’t find · stock left alone</span>
                              </span>
                            ) : (
                              <span className="font-mono font-semibold text-gray-900 flex-shrink-0">{v} {uom}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : groupMode === 'type' ? (
                <div className="mt-2">
                  {typeGroups.length === 0 ? (
                    <p className="text-center text-gray-400 text-[var(--fs-sm)] py-8">Nothing counted yet.</p>
                  ) : typeGroups.map((key) => {
                    const g = byType[key];
                    const label = key === 'general' ? 'General / unplaced' : typeLabel(key);
                    const icon = key === 'general' ? '📍' : typeIcon(key);
                    const prods = Object.entries(g.products)
                      .map(([pid, qty]) => ({ pid, nm: reviewProducts.find((x: any) => x.id === Number(pid))?.name || `#${pid}`, qty }))
                      .sort((a, b) => a.nm.localeCompare(b.nm));
                    return (
                      <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                          <span className="text-[var(--fs-sm)] font-bold tracking-wide uppercase text-gray-800 truncate">{icon} {label}</span>
                          <span className="font-mono font-bold text-gray-700 flex-shrink-0 ml-2">{g.qty}</span>
                        </div>
                        {prods.map((it) => (
                          <div key={it.pid} className="flex items-center justify-between px-4 py-2 border-b border-gray-50 last:border-b-0">
                            <span className="text-[var(--fs-base)] text-gray-800 truncate">{it.nm}</span>
                            <span className="font-mono font-semibold text-gray-900 flex-shrink-0 ml-2">{it.qty}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (<>
              {countedProducts.length > 0 && (<>
                <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items</p>
                {countedProducts.map((p: any) => {
                  const val = entryMap[p.id]; const uom = p.uom_id?.[1] || 'Units';
                  const sysQty = reviewSystemQtys[p.id];
                  const hasSysQty = sysQty !== undefined && sysQty !== null;
                  const diff = hasSysQty ? val - sysQty : null;
                  const diffPct = hasSysQty && sysQty > 0 ? Math.round((diff! / sysQty) * 100) : null;
                  const isOut = isOutOfStock(p.id);
                  const isVariance = !isOut && diffPct !== null && Math.abs(diffPct) > 10;
                  const isDraft = p.is_draft === true;
                  const decision = draftDecisions[p.id];
                  const entry = entryByProduct[p.id];
                  const isCrate = hasCrate(entry?.units_per_crate);
                  const pWords = unitWords(uom, reviewPackLabels[p.id], reviewLooseLabels[p.id]);
                  const packLabel = pWords.pack;
                  // `val` is the total ACROSS spots, so the split beside it has to
                  // be too. `entry` is only the last row iterated, and showing its
                  // split here read "5 crates" over a product with 2 in the bar and
                  // 5 in the cellar — the split of one spot, captioning the total.
                  const pEntries = entriesByProduct[p.id] || [];
                  const split = isCrate ? (() => {
                    const stored = pEntries.some((e: any) => e.crate_qty != null || e.loose_qty != null)
                      ? pEntries.reduce(
                          (a: { crates: number; loose: number }, e: any) => ({
                            crates: a.crates + (Number(e.crate_qty) || 0),
                            loose: a.loose + (Number(e.loose_qty) || 0),
                          }),
                          { crates: 0, loose: 0 },
                        )
                      : null;
                    // The stored split is only a description of the total, and the
                    // server keeps it when a later plain save changes that total —
                    // so a line stepped back down to zero still carried "1 bunch",
                    // and this screen showed 1 bunch over a count of 0. Use it only
                    // while it still adds up; otherwise derive it from the total,
                    // which is what approval actually writes.
                    if (stored && crateTotal(stored.crates, stored.loose, entry?.units_per_crate) === val) return stored;
                    return splitFromTotal(val, entry?.units_per_crate);
                  })() : null;
                  return (
                    <div key={p.id}>
                      <div className={`flex items-center justify-between py-2.5 border-b ${isVariance ? 'border-red-100 bg-red-50/50' : 'border-gray-100'}`}>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isOut || isVariance ? 'bg-red-100' : 'bg-green-100'}`}>
                            {isOut ? (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            ) : isVariance ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                            )}
                          </div>
                          <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={36} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[var(--fs-base)] text-gray-900 truncate">{p.name}</span>
                              {/* Drill-down: open the product (verify unit/name behind a count) */}
                              <RecordLink type="product" id={p.id} label={p.name} className="w-6 h-6" />
                              {isDraft && !decision && (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">Pending</span>
                              )}
                              {decision && (
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  decision === 'approved' ? 'bg-green-100 text-green-700 border border-green-200' :
                                  decision === 'linked' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                                  'bg-red-100 text-red-700 border border-red-200'
                                }`}>{decision}</span>
                              )}
                              {isOut && (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 flex-shrink-0">{hasSpotLayout ? 'None anywhere' : 'Out of stock'}</span>
                              )}
                              {partialProducts.includes(p) && (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                                  counted {(entriesByProduct[p.id] || []).length} of {snapshotLinesOf[p.id]?.length || 0} spots
                                </span>
                              )}
                            </div>
                            {!isOut && hasSysQty && (
                              <span className={`text-[var(--fs-xs)] ${isVariance ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                                System: {sysQty} {uom} {diff !== null && `(${diff > 0 ? '+' : ''}${diff})`}
                              </span>
                            )}
                            {(() => {
                              // Past counts, as a range. A number means nothing on
                              // its own; "28-36 the last 5 times" is what tells a
                              // manager whether today's 31 is fine or 300 is a typo.
                              const past = reviewHistory[p.id] || [];
                              if (past.length === 0) return null;
                              const qs = past.map((x) => x.qty);
                              const lo = Math.min(...qs), hi = Math.max(...qs);
                              return (
                                <span className="block text-[var(--fs-xs)] text-gray-400">
                                  Last {past.length === 1 ? 'count' : `${past.length} counts`}:{' '}
                                  {lo === hi ? `${lo}` : `${lo}\u2013${hi}`} {uom}
                                </span>
                              );
                            })()}
                            {hasSpotLayout && (snapshotLinesOf[p.id] || [0]).length > 0 && (
                              <div className="mt-1 flex flex-col gap-0.5">
                                {(snapshotLinesOf[p.id] || [0]).map((loc: number) => {
                                  const le = (entriesByProduct[p.id] || []).find((e: any) => (e.count_location_id ?? 0) === loc);
                                  const skipped = reviewSkips[loc];
                                  return (
                                    <button key={loc} disabled={!isSubmitted}
                                      onClick={() => setEditLine({ product: p, loc })}
                                      className="flex items-center gap-2 text-left active:bg-gray-50 rounded-md px-1 -mx-1">
                                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${loc === 0 ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>{spotName(loc)}</span>
                                      {le ? (
                                        <span className={`text-[var(--fs-xs)] font-mono font-bold ${
                                          le.out_of_stock ? 'text-red-600' : le.not_found ? 'text-amber-700' : 'text-gray-700'
                                        }`}>
                                          {le.out_of_stock ? 'none here'
                                            : le.not_found ? 'couldn’t find'
                                            : `${le.counted_qty} ${uom}`}
                                          {le.manager_note && <span className="text-amber-600 font-sans font-semibold"> {'\u00B7'} edited</span>}
                                        </span>
                                      ) : (
                                        <span className="text-[var(--fs-xs)] font-semibold text-amber-700">
                                          not counted{skipped ? ` \u00B7 skipped: \u201C${skipped}\u201D` : ''}
                                        </span>
                                      )}
                                      {isSubmitted && <span className="text-[10px] text-gray-300">{'\u270E'}</span>}
                                      {le?.notes && (
                                        <span className="text-[var(--fs-xs)] text-gray-600 italic min-w-0 truncate" title={le.notes}>
                                          {'\u201C'}{le.notes}{'\u201D'}
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {/* Flat counts have no spot rows to hang these on, so the
                                note and the edited mark get their own line — a note
                                the manager cannot read is a note that was never taken. */}
                            {!hasSpotLayout && (() => {
                              const le = (entriesByProduct[p.id] || [])[0];
                              if (!le || (!le.notes && !le.manager_note)) return null;
                              return (
                                <div className="mt-1 flex items-center gap-2 min-w-0">
                                  {le.notes && (
                                    <span className="text-[var(--fs-xs)] text-gray-600 italic truncate" title={le.notes}>
                                      {'\u201C'}{le.notes}{'\u201D'}
                                    </span>
                                  )}
                                  {le.manager_note && (
                                    <span className="text-[var(--fs-xs)] text-amber-600 font-semibold flex-shrink-0">edited</span>
                                  )}
                                </div>
                              );
                            })()}
                            {(() => {
                              const entryPhotos: string[] = (entriesByProduct[p.id] || [])
                                .flatMap((e: any) => (e.photos || []) as string[]);
                              if (entryPhotos.length === 0) return null;
                              return (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  {entryPhotos.map((src: string, i: number) => (
                                    <button
                                      key={i}
                                      onClick={(ev) => { ev.stopPropagation(); setLightbox({ open: true, photos: entryPhotos, index: i }); }}
                                      className="w-8 h-8 rounded-md overflow-hidden border border-gray-200 bg-gray-100 active:opacity-70"
                                      aria-label={`View photo ${i + 1}`}
                                    >
                                      <img src={src} alt="" className="w-full h-full object-cover" />
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                        <span className="text-[14px] font-mono font-semibold flex-shrink-0 ml-3 text-right">
                          {isOut ? (
                            <span className="text-red-600 font-sans font-semibold">None here</span>
                          ) : isCrate && dispMode === 'split' && split ? (
                            <span className="text-gray-900">{formatSplit(split.crates, split.loose, pWords.loose, packLabel)}</span>
                          ) : (
                            <span className="text-gray-900">{val} <span className="text-[var(--fs-xs)] text-gray-400 font-normal">{uom}</span></span>
                          )}
                        </span>
                      </div>
                      {isDraft && !decision && (
                        <DraftReviewPanel
                          product={p}
                          onApproved={() => setDraftDecisions(d => ({ ...d, [p.id]: 'approved' }))}
                          onLinked={() => setDraftDecisions(d => ({ ...d, [p.id]: 'linked' }))}
                          onRejected={() => setDraftDecisions(d => ({ ...d, [p.id]: 'rejected' }))}
                        />
                      )}
                    </div>
                  );
                })}
              </>)}

              {uncountedProducts.length > 0 && (<>
                <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted</p>
                {uncountedProducts.map((p) => {
                  const uom = p.uom_id?.[1] || 'Units';
                  return (<div key={p.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0"><span className="text-gray-400 text-[var(--fs-xs)] font-bold">--</span></div>
                      <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={32} />
                      <span className="text-[var(--fs-base)] text-gray-500 truncate">{p.name}</span>
                    </div>
                    <span className="text-[var(--fs-sm)] text-gray-400 flex-shrink-0 ml-3">-- {uom}</span>
                  </div>);
                })}
              </>)}
              </>)}
            </div>

            {isSubmitted && (
              <div className="px-4 py-3">
                {hasUnresolvedDrafts && (
                  <p className="text-[12px] text-amber-700 mb-2 font-semibold">Resolve all pending products before approving.</p>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm('reject')} className="py-3.5 px-6 rounded-xl border border-red-200 text-red-600 text-[14px] font-bold active:bg-red-50">Reject</button>
                  <button
                    onClick={() => setShowConfirm('approve')}
                    disabled={hasUnresolvedDrafts}
                    className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-40 disabled:bg-gray-400 disabled:shadow-none"
                  >Approve</button>
                </div>
              </div>
            )}

            {showConfirm && (
              <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
                <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
                  <h3 className="text-[17px] font-bold text-gray-900 mb-2">{showConfirm === 'approve' ? 'Approve this count?' : 'Reject this count?'}</h3>
                  <p className="text-[var(--fs-base)] text-gray-500 mb-5">
                    {showConfirm === 'approve'
                      ? `This will accept ${trueCountedCount} counted item${trueCountedCount !== 1 ? 's' : ''}${outOfStockCount > 0 ? ` and ${outOfStockCount} marked out of stock` : ''}.`
                      : 'The staff member will be notified and can recount.'}
                    {showConfirm === 'approve' && partialProducts.length > 0 && (
                      <span className="block mt-2 text-amber-700 font-semibold">
                        {'\u26A0'} {partialProducts.length} product{partialProducts.length !== 1 ? 's were' : ' was'} only PARTLY counted
                        ({partialProducts.map((pp: any) => pp.name).join(', ')}) {'\u2014'} the totals include only the counted spots.
                      </span>
                    )}
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setShowConfirm(null)} className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[14px] font-semibold active:bg-gray-200">Cancel</button>
                    <button onClick={() => handleSessionAction(showConfirm)} disabled={actionLoading !== null}
                      className={`flex-1 py-3.5 rounded-xl text-white text-[14px] font-bold disabled:opacity-50 ${showConfirm === 'approve' ? 'bg-green-600 shadow-lg shadow-green-600/30 active:bg-green-700' : 'bg-red-500 shadow-lg shadow-red-500/30 active:bg-red-600'}`}>
                      {actionLoading !== null ? '...' : showConfirm === 'approve' ? 'Yes, approve' : 'Yes, reject'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {editLine && (
              <NumpadModal
                open
                productName={`${editLine.product.name} \u00B7 ${editLine.loc === 0 ? 'General' : (reviewSpots.find((sp: any) => sp.count_location_id === editLine.loc)?.name || 'Spot')}`}
                category="Manager correction"
                uom={editLine.product.uom_id?.[1] || 'Units'}
                showSystemQty={false}
                systemQty={null}
                locationName=""
                initialValue={(() => { const e = reviewEntries.find((x: any) => x.product_id === editLine.product.id && (x.count_location_id ?? 0) === editLine.loc); return e ? e.counted_qty : null; })()}
                onSave={saveLineEdit}
                onClose={() => setEditLine(null)}
              />
            )}
          </>
        )}
      </div>
    );
  }

  // ======== LIST VIEW ========
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-1">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setTab('sessions')}
            className={`flex-1 py-2.5 rounded-lg text-[var(--fs-base)] font-semibold text-center transition-all ${tab === 'sessions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            Sessions {pendingSessions > 0 && <span className="ml-1 text-[var(--fs-xs)] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{pendingSessions}</span>}
          </button>
          <button onClick={() => setTab('quick')}
            className={`flex-1 py-2.5 rounded-lg text-[var(--fs-base)] font-semibold text-center transition-all ${tab === 'quick' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            Quick counts {pendingQC > 0 && <span className="ml-1 text-[var(--fs-xs)] bg-red-500 text-white px-1.5 py-0.5 rounded-full">{pendingQC}</span>}
          </button>
        </div>
      </div>

      <div className="pt-2">
        <FilterBar>
          {['submitted', 'approved', 'rejected'].map((s) => (
            <FilterPill key={s} active={filter === s} label={s.charAt(0).toUpperCase() + s.slice(1)}
              onClick={() => { setFilter(s); setDateRange(null); }} />
          ))}
        </FilterBar>
      </div>

      {showDateFilter && (
        <div className="px-4 pb-2">
          <StandardFilter onChange={(range) => setDateRange(range)} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <Spinner /> : (<>
          {tab === 'sessions' && (
            sessions.length === 0 ? (
              <EmptyState icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>} title={`No ${filter} sessions`} />
            ) : (
              <div className="flex flex-col gap-3">
                {sessions.map((sess: any) => (
                  <div key={sess.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--fs-lg)] font-bold text-gray-900">{sess.template_name || `Session #${sess.id}`}</span>
                      <StatusBadge status={sess.status} />
                    </div>
                    <div className="text-[var(--fs-sm)] text-gray-500 mb-3">{[sess.scheduled_date, locationName(sess.location_id)].filter(Boolean).join(' \u00B7 ')}</div>
                    {sess.status === 'submitted' ? (
                      <button onClick={() => openReview(sess)} className="w-full py-2.5 rounded-xl bg-green-600 text-white text-[var(--fs-base)] font-bold active:bg-green-700 shadow-sm">Review</button>
                    ) : sess.status === 'rejected' ? (
                      <div className="flex gap-2">
                        <button onClick={() => openReview(sess)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[var(--fs-base)] font-semibold active:bg-gray-200">View</button>
                        <button onClick={() => handleRecount(sess.id)} disabled={actionLoading === sess.id}
                          className="flex-1 py-2.5 rounded-xl border border-amber-300 text-amber-700 text-[var(--fs-base)] font-bold active:bg-amber-50 disabled:opacity-50">
                          {actionLoading === sess.id ? '...' : 'Recount'}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => openReview(sess)} className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[var(--fs-base)] font-semibold active:bg-gray-200">View details</button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'quick' && (
            quickCounts.length === 0 ? (
              <EmptyState icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>} title={`No ${filter} quick counts`} />
            ) : (
              <div className="flex flex-col gap-3">
                {quickCounts.map((qc: any) => (
                  <div key={qc.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--fs-lg)] font-bold text-gray-900">Product #{qc.product_id}</span>
                      <StatusBadge status={qc.status} />
                    </div>
                    <div className="flex items-center gap-3 text-[var(--fs-base)] text-gray-500 mb-3">
                      <span className="font-mono font-semibold text-gray-900">{qc.counted_qty} {qc.uom}</span>
                      <span>by {qc.counted_by_name || `user #${qc.counted_by}`}</span>
                      <span>{new Date(qc.submitted_at).toLocaleDateString('de-DE')}</span>
                    </div>
                    {qc.status === 'pending' ? (
                      <button onClick={() => openQCReview(qc)} className="w-full py-2.5 rounded-xl bg-green-600 text-white text-[var(--fs-base)] font-bold active:bg-green-700 shadow-sm">Review</button>
                    ) : (
                      <button onClick={() => openQCReview(qc)} className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[var(--fs-base)] font-semibold active:bg-gray-200">View details</button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </>)}
      </div>
      <PhotoLightbox
        open={lightbox.open}
        photos={lightbox.photos}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ open: false, photos: [], index: 0 })}
      />
    </div>
  );
}

/* ───── DraftReviewPanel ───── */

interface DraftReviewPanelProps {
  product: any;
  onApproved: () => void;
  onLinked: () => void;
  onRejected: () => void;
}

function DraftReviewPanel({ product, onApproved, onLinked, onRejected }: DraftReviewPanelProps) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'link' | 'reject'>('idle');
  const [name, setName] = useState(product.name || '');
  const [categories, setCategories] = useState<any[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [categId, setCategId] = useState<number | null>(null);
  const [uomId, setUomId] = useState<number | null>(null);
  const [cost, setCost] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [vendor, setVendor] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [similarMatches, setSimilarMatches] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'approve') return;
    fetch('/api/inventory/categories').then(r => r.json()).then(d => setCategories(d.categories || [])).catch(() => {});
    fetch('/api/inventory/uoms').then(r => r.json()).then(d => setUoms(d.uoms || [])).catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== 'approve') { setSimilarMatches([]); return; }
    const trimmed = name.trim();
    if (trimmed.length < 2) { setSimilarMatches([]); return; }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/inventory/products/similar?name=${encodeURIComponent(trimmed)}&exclude_id=${product.id}`, { signal: controller.signal })
        .then(r => r.json())
        .then(d => setSimilarMatches(d.matches || []))
        .catch(() => {});
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [mode, name, product.id]);

  // Vendor search (only while approving and user is typing)
  useEffect(() => {
    if (mode !== 'approve') return;
    if (vendor) return; // vendor picked — don't search
    const controller = new AbortController();
    const t = setTimeout(() => {
      const q = vendorSearch.trim();
      const url = q.length >= 1
        ? `/api/inventory/vendors?search=${encodeURIComponent(q)}`
        : '/api/inventory/vendors';
      fetch(url, { signal: controller.signal })
        .then(r => r.json())
        .then(d => setVendors(d.vendors || []))
        .catch(() => {});
    }, 250);
    return () => { clearTimeout(t); controller.abort(); };
  }, [mode, vendorSearch, vendor]);

  useEffect(() => {
    if (mode !== 'link' || search.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/inventory/products?search=${encodeURIComponent(search)}&limit=20`)
        .then(r => r.json())
        .then(d => setSearchResults((d.products || []).filter((p: any) => p.active !== false)))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, mode]);

  async function handleApprove() {
    if (!name.trim() || !categId || !uomId) return;
    const costNum = cost.trim() === '' ? null : parseFloat(cost.replace(',', '.'));
    if (costNum !== null && (isNaN(costNum) || costNum < 0)) {
      setError('Cost must be a positive number');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          categ_id: categId,
          uom_id: uomId,
          cost: costNum,
          vendor_id: vendor?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Approve failed'); setSubmitting(false); return; }
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  async function handleLink(target: any) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_product_id: target.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Link failed'); setSubmitting(false); return; }
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  // Rejecting deletes any counting already done for this draft. The server
  // refuses the first attempt and names what would go; only then can it be
  // confirmed. Nobody's numbers disappear without them being told first.
  const [willErase, setWillErase] = useState<string[] | null>(null);

  async function handleReject(confirm = false) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/inventory/products/${product.id}/reject${confirm ? '?confirm=1' : ''}`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (res.status === 409 && data.code === 'WOULD_ERASE_COUNTS') {
        setWillErase(data.work?.where || ['some counting already done']);
        setSubmitting(false);
        return;
      }
      if (!res.ok) { setError(data.error || 'Reject failed'); setSubmitting(false); return; }
      onRejected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
      {mode === 'idle' && (
        <div className="flex gap-2">
          <button onClick={() => setMode('approve')} className="flex-1 py-2 rounded-lg bg-[#F5800A] text-white text-[13px] font-bold active:bg-[#E86000]">Confirm as new</button>
          <button onClick={() => setMode('link')} className="flex-1 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Link to existing</button>
          <button onClick={() => setMode('reject')} className="flex-1 py-2 rounded-lg bg-white border border-red-300 text-red-600 text-[13px] font-semibold active:bg-red-50">Reject</button>
        </div>
      )}

      {mode === 'approve' && (
        <div className="space-y-2">
          {similarMatches.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300">
              <div className="flex items-start gap-2 mb-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p className="text-[12px] font-semibold text-amber-800">
                  {similarMatches.length} similar product{similarMatches.length !== 1 ? 's' : ''} already exist. Duplicate?
                </p>
              </div>
              <div className="flex flex-col gap-1">
                {similarMatches.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => handleLink(m)}
                    disabled={submitting}
                    className="text-left px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 text-[13px] active:bg-amber-50 disabled:opacity-50"
                  >
                    <span className="font-semibold text-gray-900">{m.name}</span>
                    <span className="text-gray-500 text-[11px] ml-2">{m.categ_id?.[1] || ''}</span>
                    <span className="text-amber-700 text-[11px] ml-2 font-semibold">Link to this →</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]" />
          <select value={categId ?? ''} onChange={(e) => setCategId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]">
            <option value="">Select category…</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.complete_name || c.name}</option>)}
          </select>
          <select value={uomId ?? ''} onChange={(e) => setUomId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]">
            <option value="">Select unit of measure…</option>
            {uoms.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input
            type="text"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Cost per unit (optional)"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]"
          />
          {vendor ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-200 text-[14px]">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-gray-500 uppercase">Vendor</p>
                <p className="text-[14px] text-gray-900 truncate">{vendor.name}</p>
              </div>
              <button
                onClick={() => setVendor(null)}
                className="text-[12px] text-[#F5800A] font-semibold ml-2"
              >Change</button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                placeholder="Search vendor (optional)"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]"
              />
              {vendors.length > 0 && (
                <div className="max-h-32 overflow-y-auto flex flex-col gap-1 bg-white border border-gray-200 rounded-lg">
                  {vendors.map((v: any) => (
                    <button
                      key={v.id}
                      onClick={() => { setVendor({ id: v.id, name: v.name }); setVendorSearch(''); }}
                      className="text-left px-3 py-2 text-[13px] active:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >{v.name}</button>
                  ))}
                </div>
              )}
            </>
          )}
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode('idle')} disabled={submitting} className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Back</button>
            <button onClick={handleApprove} disabled={submitting || !name.trim() || !categId || !uomId} className="flex-[2] py-2 rounded-lg bg-[#F5800A] text-white text-[13px] font-bold disabled:opacity-40">
              {submitting ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      )}

      {mode === 'link' && (
        <div className="space-y-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search existing product…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]" autoFocus />
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {searchResults.map((r: any) => (
              <button key={r.id} onClick={() => handleLink(r)} disabled={submitting}
                className="text-left px-3 py-2 rounded-lg bg-white border border-gray-200 text-[13px] active:bg-gray-50">
                <span className="font-semibold text-gray-900">{r.name}</span>
                <span className="text-gray-500 ml-2">{r.categ_id?.[1]}</span>
              </button>
            ))}
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <button onClick={() => setMode('idle')} className="w-full py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Cancel</button>
        </div>
      )}

      {mode === 'reject' && (
        <div className="space-y-2">
          <p className="text-[13px] text-gray-700">Reject this product and drop its count line?</p>
          {willErase && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-2">
              <p className="text-[12px] font-bold text-red-800">This deletes numbers someone already counted:</p>
              <ul className="mt-1 text-[12px] text-red-700 list-disc pl-4">
                {willErase.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="text-[11px] text-red-700 mt-1">There is no way to get them back.</p>
            </div>
          )}
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setMode('idle'); setWillErase(null); }} disabled={submitting} className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Back</button>
            <button onClick={() => handleReject(!!willErase)} disabled={submitting} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-[13px] font-bold">
              {submitting ? 'Rejecting…' : willErase ? 'Yes, delete those numbers' : 'Confirm reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
