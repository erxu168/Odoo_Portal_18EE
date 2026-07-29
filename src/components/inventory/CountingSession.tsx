'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BackHeader, FilterBar, FilterPill, SearchBar, CountProgress, Stepper, Spinner, EmptyState, leafCategory, ProductThumb } from './ui';
import NumpadModal from './NumpadModal';
import CrateCountSheet from './CrateCountSheet';
import BarcodeScanner from '@/components/ui/BarcodeScanner';
import PhotoCaptureStrip from './PhotoCaptureStrip';
import OfflineBanner from './OfflineBanner';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { patchCachedSessionData, getCachedSessionData, updateCachedEntry } from '@/lib/inventory-offline';
import { offlineSafeMutate } from '@/lib/inventory-offline-fetch';
import { hasCrate, crateTotal, splitFromTotal, formatSplit, unitWords, pluralizePack } from '@/lib/crate-units';
import { packTotal, countableLevels, splitToLevels, type PackLevel } from '@/lib/packaging';
import PackCountSheet from './PackCountSheet';
import GuidedCountingFlow from './GuidedCountingFlow';
import { useTopBar } from '@/components/ui/TopBarContext';
import { plainFromOdooHtml } from '@/lib/odoo-html';

interface CountingSessionProps {
  sessionId: number;
  userRole: string;
  onBack: () => void;
  onSubmit: () => void;
}

type View = 'counting' | 'review';

/** loc id -> FULL path label (Area › Room › Unit) from the guided route's stops.
 * Each stop carries its live-tree ancestors (root→parent) + its own leaf name.
 * Static (no route statuses), so it's safe to cache for offline full-path labels. */
function composeSpotPaths(stops: any[]): Record<number, string> {
  const m: Record<number, string> = {};
  (stops || []).forEach((s: any) => {
    if (s?.location?.id != null) {
      m[s.location.id] = [...((s.ancestors || []) as any[]).map((a) => a.name), s.location.name].join(' › ');
    }
  });
  return m;
}

export default function CountingSession({ sessionId, userRole, onBack, onSubmit }: CountingSessionProps) {
  // Full-focus counting: hide the global top bar + bottom tab bar for the whole
  // count flow (same pattern the cook timer / KDS use) so the count screen isn't
  // crowded by app chrome. Restored on unmount (back to the inventory dashboard).
  const { setHidden: setChromeHidden } = useTopBar();
  useEffect(() => {
    setChromeHidden(true);
    return () => setChromeHidden(false);
  }, [setChromeHidden]);

  const [session, setSession] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  // MULTI-SPOT: everything per-LINE, keyed `${product_id}:${count_location_id}`.
  // Legacy sessions (no snapshot) use loc 0 for every line — same shape.
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [items, setItems] = useState<{ odoo_product_id: number; count_location_id: number; requires_photo?: boolean }[]>([]);
  const [spotNames, setSpotNames] = useState<Record<number, string>>({});
  const [systemQtys, setSystemQtys] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'location' | 'group' | 'product'>('location');  // how staff organise the count
  const [numpad, setNumpad] = useState<{ open: boolean; product: any | null; loc: number }>({ open: false, product: null, loc: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<View>('counting');
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [productImageIds, setProductImageIds] = useState<Set<number>>(new Set()); // products with a picture (thumbnail)
  const [rowPhotos, setRowPhotos] = useState<Record<string, string[]>>({});
  // -- Crate (multi-UoM) counting --
  const [crateSizes, setCrateSizes] = useState<Record<number, number>>({});          // product_id -> base units per pack
  const [crateLabels, setCrateLabels] = useState<Record<number, string>>({});         // product_id -> whole-unit word ('crate')
  const [looseLabels, setLooseLabels] = useState<Record<number, string>>({});         // product_id -> single-unit word ('bottle')
  const [crateSplits, setCrateSplits] = useState<Record<string, { crates: number; loose: number }>>({});
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});   // per-line note, keyed like every other line map
  const [draftNote, setDraftNote] = useState('');                          // note being typed in the open sheet
  const [staffNote, setStaffNote] = useState('');                          // one note about the WHOLE count
  const [oos, setOos] = useState<Set<string>>(new Set());   // lines marked OUT OF STOCK (deliberate none ≠ not-counted)
  const [crateSheet, setCrateSheet] = useState<{ open: boolean; product: any | null; loc: number }>({ open: false, product: null, loc: 0 });
  // The nested chain FROZEN into this count, per product. Sent by GET /counts.
  const [packaging, setPackaging] = useState<Record<number, PackLevel[]>>({});
  const [packSheet, setPackSheet] = useState<{ open: boolean; product: any | null; loc: number }>({ open: false, product: null, loc: 0 });
  const [packSplits, setPackSplits] = useState<Record<string, { byLevel: Record<number, number>; loose: number }>>({});
  // The per-product "⋯" sheet: none left / note / photo.
  const [rowMenu, setRowMenu] = useState<{ product: any; loc: number } | null>(null);
  // Scan hit a product counted at several spots → ask which one.
  const [spotChoice, setSpotChoice] = useState<{ product: any; qty: number; uom: string } | null>(null);
  // -- Guided route (Phase 2) --
  const [route, setRoute] = useState<{ guided: boolean; stops: any[] } | null>(null);
  // Full-path labels restored from the offline cache (route-derived, but the route
  // itself isn't cached — only these STATIC paths — so no stale statuses).
  const [cachedSpotPaths, setCachedSpotPaths] = useState<Record<number, string>>({});
  const [guidedStatuses, setGuidedStatuses] = useState<Record<number, { status: string; skip_reason: string | null }>>({});
  // What this restaurant wants to hold. Shown under the name so a wrong number
  // is noticed at the SHELF rather than three days later in a report.
  const [par, setPar] = useState<Record<number, { min: number | null; max: number | null }>>({});
  // Lines answered "couldn't find it" — acknowledged, quantity unknown.
  const [notFound, setNotFound] = useState<Set<string>>(new Set());
  const [statusPending, setStatusPending] = useState(0); // in-flight location-status writes
  const [savesPending, setSavesPending] = useState(0);
  // A refusal the server sent back. Shown until dismissed — a count that did
  // not save is not something to flash for three seconds and hide.
  const [saveError, setSaveError] = useState<string | null>(null);   // in-flight count saves/deletes

  // -- Barcode scanner --
  const [showScanner, setShowScanner] = useState(false);
  const [hwBarcode, setHwBarcode] = useState<string | undefined>();

  // -- Offline / sync queue --
  const sync = useSyncQueue();

  function handleHardwareScan(barcode: string) {
    const product = products.find((p: any) => p.barcode && p.barcode === barcode);
    if (product) {
      setSearch('');
      setCatFilter('all');
      setStatusFilter('all');
      // Multi-spot: default to the first line still uncounted (walk order).
      const locs = spotsOfProduct.get(product.id) || [0];
      const target = locs.find((l) => entries[K(product.id, l)] === undefined) ?? locs[0];
      openNumpad(product, target);
    }
  }

  useHardwareScanner({
    enabled: view === 'counting' && !numpad.open && !showScanner && !showConfirm && !loading,
    onScan: handleHardwareScan,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);

    // Helper: apply a payload (from network or cache) to state.
    function apply(sess: any, products: any[], entriesArr: any[], sysQtys: Record<number, number>) {
      setSession(sess);
      setStaffNote(sess?.staff_note || '');
      const entryMap: Record<string, number> = {};
      const photoMap: Record<string, string[]> = {};
      const splitMap: Record<string, { crates: number; loose: number }> = {};
      const oosSet = new Set<string>();
      const nfSet = new Set<string>();
      const noteMap: Record<string, string> = {};
      for (const e of entriesArr || []) {
        const k = `${e.product_id}:${e.count_location_id ?? 0}`;
        entryMap[k] = e.counted_qty;
        if (e.out_of_stock) oosSet.add(k);
        if (e.not_found) nfSet.add(k);
        if (Array.isArray(e.photos) && e.photos.length > 0) {
          photoMap[k] = e.photos;
        }
        if (e.crate_qty != null || e.loose_qty != null) {
          splitMap[k] = { crates: Number(e.crate_qty) || 0, loose: Number(e.loose_qty) || 0 };
        }
        if (e.notes) noteMap[k] = e.notes;
      }
      setEntries(entryMap);
      setNotFound(nfSet);
      setOos(oosSet);
      setRowPhotos(photoMap);
      setCrateSplits(splitMap);
      setRowNotes(noteMap);
      setSystemQtys(sysQtys || {});
      setProducts(products);
    }

    try {
      const [sessRes, countRes] = await Promise.all([
        fetch('/api/inventory/sessions').then((r) => r.json()),
        fetch(`/api/inventory/counts?session_id=${sessionId}`).then((r) => r.json()),
      ]);

      const sess = (sessRes.sessions || []).find((s: any) => s.id === sessionId);

      // MODERN sessions: the FROZEN snapshot decides what to count — template
      // edits after creation must not add/hide lines. Legacy: template as before.
      const snapItems: any[] = countRes.items || [];
      let productIds: number[] = [];
      let categoryIds: number[] = [];
      if (snapItems.length > 0) {
        productIds = Array.from(new Set<number>(snapItems.map((it: any) => it.odoo_product_id)));
      } else {
        try { productIds = JSON.parse(sess?.template_product_ids || '[]'); } catch { productIds = []; }
        try { categoryIds = JSON.parse(sess?.template_category_ids || '[]'); } catch { categoryIds = []; }
      }

      let loadedProducts: any[] = [];

      if (productIds.length > 0) {
        // limit MUST cover the whole count. The API defaults to 200, so a
        // larger list silently rendered only the first 200 rows — and now that
        // submitting demands an answer for every line, the missing ones would
        // be unanswerable and the count could never be sent.
        const prodRes = await fetch(
          `/api/inventory/products?ids=${productIds.join(',')}&limit=${Math.max(200, productIds.length)}`,
        ).then(r => r.json());
        loadedProducts = prodRes.products || [];
      } else if (categoryIds.length > 0) {
        const promises = categoryIds.map(cid =>
          fetch(`/api/inventory/products?category_id=${cid}&include_pos=1`).then(r => r.json())
        );
        const results = await Promise.all(promises);
        const seen = new Set<number>();
        results.forEach(r => {
          (r.products || []).forEach((p: any) => {
            if (!seen.has(p.id)) { seen.add(p.id); loadedProducts.push(p); }
          });
        });
      }

      apply(sess, loadedProducts, countRes.entries || [], countRes.system_qtys || {});
      // Frozen snapshot: one line per (product, spot). Legacy sessions have none
      // -> every product becomes a single loc-0 line (derived in `lines` below).
      setItems(countRes.items || []);
      setPackaging(countRes.packaging || {});
      const sn: Record<number, string> = {};
      (countRes.spots || []).forEach((sp: any) => { sn[sp.count_location_id] = sp.name; });
      setSpotNames(sn);

      // Cache to IDB for offline use. Two effects fill this row and finish in
      // either order, so each writes ONLY its own fields — a whole-record write
      // from here used to blank the pack sizes the flags effect had just saved.
      void patchCachedSessionData(sessionId, {
        session: sess,
        products: loadedProducts,
        entries: countRes.entries || [],
        systemQtys: countRes.system_qtys || {},
        items: countRes.items || [],
        spots: countRes.spots || [],
      });
    } catch (err) {
      console.warn('Network fetch failed, attempting cache fallback:', err);
      const cached = await getCachedSessionData(sessionId);
      // Only accept a COMPLETE cache row. An independent writer (pack flags, spot
      // paths) can create a partial row with just its own field; using that would
      // pass undefined products into state and crash on the array ops below.
      if (cached && cached.session && Array.isArray(cached.products)) {
        apply(cached.session, cached.products, cached.entries, cached.systemQtys);
        if (Array.isArray((cached as any).items)) setItems((cached as any).items);
        const csn: Record<number, string> = {};
        ((cached as any).spots || []).forEach((sp: any) => { csn[sp.count_location_id] = sp.name; });
        setSpotNames(csn);
        // Restore the cached full-path labels so badges + the "Also in" note stay
        // full-path offline (the route itself isn't cached — no stale statuses).
        if ((cached as any).spotPaths) setCachedSpotPaths((cached as any).spotPaths);
        if (cached.flags) setFlags(cached.flags);
        if (cached.crateSizes) setCrateSizes(cached.crateSizes);
        if (cached.crateLabels) setCrateLabels(cached.crateLabels);
        if (cached.looseLabels) setLooseLabels(cached.looseLabels);
      } else {
        console.error('No cached data available for session', sessionId);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Par belongs to the restaurant this COUNT is for, not to whatever the top
  // bar happens to show — a manager reviewing WAJ's count from an Ssam context
  // must still see WAJ's numbers.
  useEffect(() => {
    const co = (session as any)?.company_id;
    if (!co) return;
    let stale = false;
    fetch(`/api/inventory/product-par?company_id=${co}`)
      .then((r) => (r.ok ? r.json() : { par: [] }))
      .then((d) => {
        if (stale) return;
        const map: Record<number, { min: number | null; max: number | null }> = {};
        (d.par || []).forEach((row: any) => {
          map[row.odoo_product_id] = { min: row.par_min ?? null, max: row.par_max ?? null };
        });
        setPar(map);
      })
      .catch(() => { /* the range is a helper, not the count */ });
    return () => { stale = true; };
  }, [session]);

  useEffect(() => {
    fetch('/api/inventory/product-flags').then(r => r.json()).then(async (d) => {
      const map: Record<number, boolean> = {};
      const crateMap: Record<number, number> = {};
      const labelMap: Record<number, string> = {};
      const looseMap: Record<number, string> = {};
      (d.flags || []).forEach((f: any) => {
        map[f.odoo_product_id] = !!f.requires_photo;
        if (f.units_per_crate != null && Number(f.units_per_crate) > 0) crateMap[f.odoo_product_id] = Number(f.units_per_crate);
        if (f.pack_label) labelMap[f.odoo_product_id] = f.pack_label;
        if (f.loose_label) looseMap[f.odoo_product_id] = f.loose_label;
      });
      setFlags(map);
      setCrateSizes(crateMap);
      setCrateLabels(labelMap);
      setLooseLabels(looseMap);
      // Pack sizes and photo rules into the cache so an offline reload still
      // knows a crate is 24. This must work on a session's FIRST open, when the
      // row does not exist yet — hence a patch that creates it.
      void patchCachedSessionData(sessionId, {
        flags: map, crateSizes: crateMap, crateLabels: labelMap, looseLabels: looseMap,
      });
    }).catch(() => {});
  }, [sessionId]);

  // Which products have a picture — so each row shows a recognition thumbnail.
  useEffect(() => {
    fetch('/api/inventory/product-images')
      .then(r => r.ok ? r.json() : { with_images: [] })
      .then(d => setProductImageIds(new Set<number>(d.with_images || [])))
      .catch(() => {});
  }, []);

  // Guided route: the session's locations + each stop's counted/skipped status.
  useEffect(() => {
    fetch(`/api/inventory/sessions/${sessionId}/route`).then(r => r.ok ? r.json() : null).then((d) => {
      if (!d) return;
      setRoute(d);
      // Cache only the STATIC path labels (not the route's dynamic statuses) so
      // full-path labels survive an offline reload without going stale.
      void patchCachedSessionData(sessionId, { spotPaths: composeSpotPaths(d.stops || []) });
      const st: Record<number, { status: string; skip_reason: string | null }> = {};
      (d.stops || []).forEach((s: any) => {
        if (s.status && s.status !== 'pending') st[s.bucket_id] = { status: s.status, skip_reason: s.skip_reason ?? null };
      });
      setGuidedStatuses(st);
    }).catch(() => {});
  }, [sessionId]);

  // Mark a location counted / skipped. Offline-safe: queues + drains on reconnect
  // (submit is blocked until the queue is empty, so the server sees these first).
  async function postStopStatus(bucketId: number, status: string, skipReason: string | null) {
    const prev = guidedStatuses[bucketId];
    setGuidedStatuses((p) => ({ ...p, [bucketId]: { status, skip_reason: skipReason } }));
    setStatusPending((n) => n + 1);
    try {
      const res = await offlineSafeMutate({
        url: `/api/inventory/sessions/${sessionId}/location-status`,
        method: 'POST',
        body: { count_location_id: bucketId, status, skip_reason: skipReason },
        dedupKey: `locstatus:${sessionId}:${bucketId}`,
      });
      if (res.queued) { await sync.refresh(); }
      else if (!res.ok) {
        // Server rejected it (4xx) — roll back the optimistic mark.
        setGuidedStatuses((p) => { const n = { ...p }; if (prev) n[bucketId] = prev; else delete n[bucketId]; return n; });
      }
    } finally {
      setStatusPending((n) => n - 1);
    }
  }

  // Build categories using LEAF names only
  const categories = React.useMemo(() => {
    const cats = new Map<string, { id: number; leaf: string }>();
    products.forEach((p) => {
      if (p.categ_id) {
        const leaf = leafCategory(p.categ_id[1]);
        if (!cats.has(leaf)) cats.set(leaf, { id: p.categ_id[0], leaf });
      }
    });
    return Array.from(cats.values());
  }, [products]);

  const filtered = React.useMemo(() => {
    let list = [...products];
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== 'all') {
      list = list.filter((p) => {
        const leaf = leafCategory(p.categ_id?.[1] || '');
        return leaf === catFilter;
      });
    }
    return list;
  }, [products, search, catFilter]);

  const productsById = React.useMemo(() => {
    const m: Record<number, any> = {};
    products.forEach((p) => { m[p.id] = p; });
    return m;
  }, [products]);

  // The session's count LINES: one per frozen (product, spot) pair; legacy
  // sessions synthesize one loc-0 line per product. `K` is the state key.
  const K = (pid: number, loc: number) => `${pid}:${loc}`;
  const lines = React.useMemo(() => {
    if (items.length > 0) {
      return items
        .filter((it) => productsById[it.odoo_product_id])
        .map((it) => ({ pid: it.odoo_product_id, loc: it.count_location_id }));
    }
    return products.map((p) => ({ pid: p.id, loc: 0 }));
  }, [items, products, productsById]);
  const spotsOfProduct = React.useMemo(() => {
    const m = new Map<number, number[]>();
    lines.forEach((l) => { const a = m.get(l.pid) || []; a.push(l.loc); m.set(l.pid, a); });
    return m;
  }, [lines]);
  const spotLabel = (loc: number) => (loc === 0 ? 'General' : (spotNames[loc] || `Spot ${loc}`));
  // Staff must see the FULL location path (Area › Room › Unit), not just the leaf.
  // The guided route enriches each stop with its live-tree ancestors, so build a
  // loc -> full path map from it; spotFullPath falls back to the leaf name for
  // flat (non-guided) lists that carry no route.
  // Live route paths take precedence; cached paths fill in after an offline reload.
  const fullPathByLoc = React.useMemo(
    () => ({ ...cachedSpotPaths, ...composeSpotPaths(route?.stops || []) }),
    [route, cachedSpotPaths],
  );
  const spotFullPath = (loc: number) => (loc === 0 ? 'General' : (fullPathByLoc[loc] || spotLabel(loc)));
  const hasSpots = React.useMemo(() => lines.some((l) => l.loc !== 0), [lines]);

  const filteredLines = React.useMemo(() => {
    let list = lines.filter((l) => filtered.some((p) => p.id === l.pid));
    if (statusFilter === 'counted') list = list.filter((l) => entries[K(l.pid, l.loc)] !== undefined);
    if (statusFilter === 'uncounted') list = list.filter((l) => entries[K(l.pid, l.loc)] === undefined);
    return list;
  }, [lines, filtered, statusFilter, entries]);

  // Product-level totals for the barcode scanner (its display + increment base
  // is per product; multi-spot products go through the spot-choice sheet).
  const productTotals = React.useMemo(() => {
    const m: Record<number, number> = {};
    lines.forEach((l) => { const v = entries[K(l.pid, l.loc)]; if (v !== undefined) m[l.pid] = (m[l.pid] || 0) + v; });
    return m;
  }, [lines, entries]);

  // The next thing to count, in the order you actually WALK. `lines` comes off
  // the frozen snapshot, which is ordered by location id — a number that has
  // nothing to do with where the shelf is — so the hint has to follow the
  // route's stop order instead, and step over places already skipped.
  const nextLine = React.useMemo(() => {
    const uncounted = lines.filter((l) => entries[K(l.pid, l.loc)] === undefined);
    if (uncounted.length === 0) return null;
    if (!route?.guided) return uncounted[0];
    const live = (b: number) => (guidedStatuses[b]?.status ?? route.stops.find((s: any) => s.bucket_id === b)?.status) !== 'skipped';
    for (const stop of route.stops) {
      if (!live(stop.bucket_id)) continue;
      const hit = uncounted.find((l) => l.loc === stop.bucket_id);
      if (hit) return hit;
    }
    // Everything left sits at a skipped place — still worth pointing at.
    return uncounted[0];
  }, [lines, entries, route, guidedStatuses]);
  const countedCount = lines.filter((l) => entries[K(l.pid, l.loc)] !== undefined).length;
  const totalCount = lines.length;
  const uncountedLines = lines.filter((l) => entries[K(l.pid, l.loc)] === undefined);
  const countedLines = lines.filter((l) => entries[K(l.pid, l.loc)] !== undefined);

  // Group filtered LINES by their product's leaf category
  const grouped = React.useMemo(() => {
    const groups: { catName: string; items: { pid: number; loc: number }[] }[] = [];
    const catMap = new Map<string, { pid: number; loc: number }[]>();
    const catOrder: string[] = [];

    for (const l of filteredLines) {
      const cat = leafCategory(productsById[l.pid]?.categ_id?.[1] || 'Other');
      if (!catMap.has(cat)) {
        catMap.set(cat, []);
        catOrder.push(cat);
      }
      catMap.get(cat)!.push(l);
    }

    for (const catName of catOrder) {
      groups.push({ catName, items: catMap.get(catName)! });
    }

    return groups;
  }, [filteredLines, productsById]);


  // A count save/delete wrapped so it counts as "in flight" — submission waits
  // for these to settle, otherwise a save racing behind submit would hit the
  // now-submitted edit lock (400) and be dropped, losing the count.
  /**
   * A 4xx is a DEFINITE refusal — offlineSafeMutate queues 5xx and network
   * failures for retry, so anything reaching here with ok:false and
   * queued:false was rejected outright and will never be sent again.
   *
   * Every caller used to check only `queued`, so a refusal left the number on
   * the screen with nothing stored: staff saw "1 of 1 counted" over an empty
   * count. Now the optimistic change is undone and the refusal is on screen.
   */
  async function trackedMutate(
    opts: Parameters<typeof offlineSafeMutate>[0],
    rollback?: () => void,
  ) {
    setSavesPending((n) => n + 1);
    try {
      const res = await offlineSafeMutate(opts);
      // If it queued (offline / transient 5xx), register it in sync.pending
      // BEFORE we drop savesPending — otherwise there'd be a window where both
      // counters read zero and submit could slip past a not-yet-synced count.
      if (res.queued) await sync.refresh();
      else if (!res.ok) {
        rollback?.();
        setSaveError(res.error || 'That did not save — try again.');
      }
      return res;
    } finally {
      setSavesPending((n) => n - 1);
    }
  }

  async function saveCount(productId: number, loc: number, qty: number | null, uom: string, note?: string) {
    const k = K(productId, loc);
    // A real count (or a clear) overrides an out-of-stock mark for this line.
    setOos((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
    // ...and it replaces whatever crate split was remembered. The row shows the
    // split as its main number, so a stale one would keep reading "11 bunches"
    // over a line that now says none, and the next + would step from 11.
    setCrateSplits((prev) => { if (!(k in prev)) return prev; const n = { ...prev }; delete n[k]; return n; });
    if (qty === null || qty === undefined) {
      setEntries((prev) => { const next = { ...prev }; delete next[k]; return next; });
      void updateCachedEntry(sessionId, productId, { counted_qty: null }, loc);
      const res = await trackedMutate({
        url: `/api/inventory/counts?session_id=${sessionId}&product_id=${productId}&count_location_id=${loc}`,
        method: 'DELETE',
        dedupKey: `delete:${sessionId}:${productId}:${loc}`,
      });
      if (res.queued) void sync.refresh();
    } else {
      const wasQty = entries[k];
      // A number supersedes "couldn't find it" — the server already clears the
      // flag, and leaving it set here left the badge showing while the row held
      // a real count, so "Found it after all" would delete the new number.
      setNotFound((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
      setEntries((prev) => ({ ...prev, [k]: qty }));
      if (note !== undefined) setRowNotes((prev) => ({ ...prev, [k]: note }));
      void updateCachedEntry(sessionId, productId, { counted_qty: qty, uom, ...(note !== undefined ? { notes: note } : {}) }, loc);
      const res = await trackedMutate({
        url: '/api/inventory/counts',
        method: 'POST',
        body: { session_id: sessionId, product_id: productId, count_location_id: loc, counted_qty: qty, uom,
          ...(note !== undefined ? { notes: note } : {}) },
        dedupKey: `save:${sessionId}:${productId}:${loc}`,
      }, () => {
        setEntries((prev) => {
          const n = { ...prev };
          if (wasQty === undefined) delete n[k]; else n[k] = wasQty;
          return n;
        });
      });
      if (res.queued) void sync.refresh();
    }
  }

  // Mark (or unmark) a product OUT OF STOCK — a deliberate "none here", distinct
  // from a not-counted row. On = record a 0 with the out_of_stock flag; off =
  // clear the entry back to not-counted. Approval records it in the portal.
  /**
   * "Couldn't find it" — an answer, but not a number and NOT a zero.
   *
   * "None left here" says the shelf is empty and approval writes a real zero to
   * Odoo. This says the product is not where it should be and the quantity is
   * unknown, so approval leaves stock alone. Conflating the two would turn every
   * misplaced jar into "we have none of these".
   */
  async function saveNotFound(product: any, loc: number, on: boolean) {
    const k = K(product.id, loc);
    const uom = product.uom_id?.[1] || 'Units';
    const wasQty = entries[k];
    const wasNf = notFound.has(k);
    setCrateSplits((prev) => { if (!(k in prev)) return prev; const n = { ...prev }; delete n[k]; return n; });
    if (on) {
      setOos((prev) => { const n = new Set(prev); n.delete(k); return n; });
      setNotFound((prev) => { const n = new Set(prev); n.add(k); return n; });
      setEntries((prev) => ({ ...prev, [k]: 0 }));
      void updateCachedEntry(sessionId, product.id, { counted_qty: 0, uom }, loc);
      await trackedMutate({
        url: '/api/inventory/counts',
        method: 'POST',
        body: { session_id: sessionId, product_id: product.id, count_location_id: loc, not_found: true, counted_qty: 0, uom },
        dedupKey: `save:${sessionId}:${product.id}:${loc}`,
      }, () => {
        setNotFound((prev) => { const n = new Set(prev); if (!wasNf) n.delete(k); return n; });
        setEntries((prev) => { const n = { ...prev }; if (wasQty === undefined) delete n[k]; else n[k] = wasQty; return n; });
      });
    } else {
      setNotFound((prev) => { const n = new Set(prev); n.delete(k); return n; });
      setEntries((prev) => { const next = { ...prev }; delete next[k]; return next; });
      void updateCachedEntry(sessionId, product.id, { counted_qty: null }, loc);
      await trackedMutate({
        url: `/api/inventory/counts?session_id=${sessionId}&product_id=${product.id}&count_location_id=${loc}`,
        method: 'DELETE',
        dedupKey: `delete:${sessionId}:${product.id}:${loc}`,
      }, () => {
        setNotFound((prev) => { const n = new Set(prev); if (wasNf) n.add(k); return n; });
      });
    }
  }

  async function saveOutOfStock(product: any, loc: number, on: boolean, note?: string) {
    const uom = product.uom_id?.[1] || 'Units';
    const k = K(product.id, loc);
    // "None here" is a statement about the whole line, so the remembered crate
    // split goes with it — otherwise the row keeps displaying the old count.
    setCrateSplits((prev) => { if (!(k in prev)) return prev; const n = { ...prev }; delete n[k]; return n; });
    if (on) {
      setOos((prev) => { const n = new Set(prev); n.add(k); return n; });
      setNotFound((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
      setEntries((prev) => ({ ...prev, [k]: 0 }));
      if (note !== undefined) setRowNotes((p) => ({ ...p, [k]: note }));
      void updateCachedEntry(sessionId, product.id, { counted_qty: 0, uom, notes: note }, loc);
      const res = await trackedMutate({
        url: '/api/inventory/counts',
        method: 'POST',
        body: { session_id: sessionId, product_id: product.id, count_location_id: loc, out_of_stock: true, counted_qty: 0, uom, ...(note !== undefined ? { notes: note } : {}) },
        dedupKey: `save:${sessionId}:${product.id}:${loc}`,
      });
      if (res.queued) void sync.refresh();
    } else {
      setOos((prev) => { const n = new Set(prev); n.delete(k); return n; });
      setEntries((prev) => { const next = { ...prev }; delete next[k]; return next; });
      void updateCachedEntry(sessionId, product.id, { counted_qty: null }, loc);
      const res = await trackedMutate({
        url: `/api/inventory/counts?session_id=${sessionId}&product_id=${product.id}&count_location_id=${loc}`,
        method: 'DELETE',
        dedupKey: `delete:${sessionId}:${product.id}:${loc}`,
      });
      if (res.queued) void sync.refresh();
    }
  }

  function handleScanCount(productId: number, qty: number, uom: string) {
    const spots = spotsOfProduct.get(productId) || [0];
    if (spots.length <= 1) {
      saveCount(productId, spots[0] ?? 0, qty, uom);
    } else {
      // Counted at several spots — ask which one this scan was for.
      setSpotChoice({ product: productsById[productId] || { id: productId, name: `#${productId}` }, qty, uom });
    }
  }

  function openCrateSheet(product: any, loc: number) {
    setDraftNote(rowNotes[K(product.id, loc)] || '');
    setCrateSheet({ open: true, product, loc });
  }

  // Save a crate + loose count. Stores the base-unit total (what Odoo gets)
  // plus the crate/loose split for audit + review replay. total 0 clears it.
  async function saveCrateCount(product: any, loc: number, crates: number, loose: number, note?: string) {
    const k = K(product.id, loc);
    setOos((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
    const size = crateSizes[product.id] || 0;
    const uom = product.uom_id?.[1] || 'Units';
    const total = crateTotal(crates, loose, size);
    setCrateSheet({ open: false, product: null, loc: 0 });

    if (total <= 0) {
      setEntries((prev) => { const next = { ...prev }; delete next[k]; return next; });
      setCrateSplits((prev) => { const next = { ...prev }; delete next[k]; return next; });
      void updateCachedEntry(sessionId, product.id, { counted_qty: null }, loc);
      const res = await trackedMutate({
        url: `/api/inventory/counts?session_id=${sessionId}&product_id=${product.id}&count_location_id=${loc}`,
        method: 'DELETE',
        dedupKey: `delete:${sessionId}:${product.id}:${loc}`,
      });
      if (res.queued) void sync.refresh();
      return;
    }

    setEntries((prev) => ({ ...prev, [k]: total }));
    setCrateSplits((prev) => ({ ...prev, [k]: { crates, loose } }));
    if (note !== undefined) setRowNotes((prev) => ({ ...prev, [k]: note }));
    void updateCachedEntry(sessionId, product.id, {
      counted_qty: total, uom, crate_qty: crates, loose_qty: loose, units_per_crate: size,
    }, loc);
    const res = await trackedMutate({
      url: '/api/inventory/counts',
      method: 'POST',
      body: { session_id: sessionId, product_id: product.id, count_location_id: loc, counted_qty: total, uom, crate_qty: crates, loose_qty: loose, units_per_crate: size,
        ...(note !== undefined ? { notes: note } : {}) },
      dedupKey: `save:${sessionId}:${product.id}:${loc}`,
    });
    if (res.queued) void sync.refresh();
  }

  function stepQty(product: any, loc: number, delta: number) {
    const current = entries[K(product.id, loc)];
    const val = current !== undefined ? current : 0;
    const next = Math.max(0, val + delta);
    if (next === 0 && (current === undefined || current === 0) && delta < 0) return;
    saveCount(product.id, loc, next, product.uom_id?.[1] || 'Units');
  }

  // Step WHOLE packs (bunches/crates) for a product measured in something else.
  // Staff hold bunches; the kilograms are the manager's problem, so the pack is
  // what the stepper moves and the base total is derived, never typed.
  function stepPacks(product: any, loc: number, delta: number) {
    const size = crateSizes[product.id] || 0;
    if (!hasCrate(size)) return;
    const k = K(product.id, loc);
    const derived = splitFromTotal(entries[k] ?? 0, size);
    const cur = crateSplits[k]?.crates ?? derived.crates;
    // Keep whatever loose remainder the line already carries. Forcing it to 0
    // made one tap move the total by less than a whole pack — a line holding
    // 16 bunches + 0.02 went to 17 bunches and LOST the 0.02.
    const loose = crateSplits[k]?.loose ?? derived.loose;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    // Stepping down to nothing means "I looked and there are none", the same as
    // typing 0 anywhere else. saveCrateCount deletes a zero line, which would
    // leave the product UNCOUNTED and block the submit.
    if (next === 0 && loose === 0) {
      void saveCount(product.id, loc, 0, product.uom_id?.[1] || 'Units');
      return;
    }
    void saveCrateCount(product, loc, next, loose);
  }

  // Save a line's photos. Shared by the row strip and the per-product sheet so
  // there is one way a photo reaches the server, not two that drift.
  async function savePhotos(product: any, loc: number, next: string[]) {
    const k = K(product.id, loc);
    const val = entries[k] ?? null;
    const uom = product.uom_id?.[1] || 'Units';
    setRowPhotos((prev) => ({ ...prev, [k]: next }));
    void updateCachedEntry(sessionId, product.id, { counted_qty: val ?? undefined, uom, photos: next }, loc);
    const res = await trackedMutate({
      url: '/api/inventory/counts',
      method: 'POST',
      body: { session_id: sessionId, product_id: product.id, count_location_id: loc, counted_qty: val, uom, photos: next },
      dedupKey: `save:${sessionId}:${product.id}:${loc}`,
    });
    if (res.queued) void sync.refresh();
  }

  /**
   * Save a nested count. Only the per-level numbers travel; the server converts
   * them with the chain frozen into this count, so the total it stores is its
   * own arithmetic, never a figure this screen worked out.
   */
  async function savePackCount(product: any, loc: number, byLevel: Record<number, number>, loose: number, note?: string) {
    const k = K(product.id, loc);
    const levels = packaging[product.id] || [];
    const total = packTotal({ byLevel, loose }, levels);
    const wasQty = entries[k];
    const wasSplit = packSplits[k];
    setPackSheet({ open: false, product: null, loc: 0 });
    setOos((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
    setEntries((prev) => ({ ...prev, [k]: total }));
    setPackSplits((prev) => ({ ...prev, [k]: { byLevel, loose } }));
    if (note !== undefined) setRowNotes((prev) => ({ ...prev, [k]: note }));
    const uom = product.uom_id?.[1] || 'Units';
    void updateCachedEntry(sessionId, product.id, { counted_qty: total, uom }, loc);
    const res = await trackedMutate({
      url: '/api/inventory/counts',
      method: 'POST',
      body: {
        session_id: sessionId, product_id: product.id, count_location_id: loc,
        pack_counts: byLevel, loose_qty: loose, uom,
        ...(note !== undefined ? { notes: note } : {}),
      },
      dedupKey: `save:${sessionId}:${product.id}:${loc}`,
    }, () => {
      // Refused: put the line back exactly as it was, so the row cannot show a
      // total the count does not contain.
      setEntries((prev) => {
        const n = { ...prev };
        if (wasQty === undefined) delete n[k]; else n[k] = wasQty;
        return n;
      });
      setPackSplits((prev) => {
        const n = { ...prev };
        if (wasSplit === undefined) delete n[k]; else n[k] = wasSplit;
        return n;
      });
    });
    if (res.queued) void sync.refresh();
  }

  function openNumpad(product: any, loc: number) {
    setDraftNote(rowNotes[K(product.id, loc)] || '');
    setNumpad({ open: true, product, loc });
  }

  function handleNumpadSave(value: number | null) {
    if (numpad.product) {
      const had = rowNotes[K(numpad.product.id, numpad.loc)] || '';
      saveCount(numpad.product.id, numpad.loc, value, numpad.product.uom_id?.[1] || 'Units',
        draftNote !== had ? draftNote : undefined);
    }
    setNumpad({ open: false, product: null, loc: 0 });
    setDraftNote('');
  }

  async function handleSubmit() {
    // Submit requires server validation (count completion + photo requirements),
    // and the manager review flow needs a known-good submit state. Block while
    // offline or while there are unsynced counts to avoid a silent failure.
    if (!sync.online) {
      setSubmitError('You are offline. Connect to WiFi and try again.');
      setShowConfirm(false);
      return;
    }
    if (sync.pending > 0) {
      setSubmitError(`${sync.pending} count change${sync.pending !== 1 ? 's are' : ' is'} still syncing — wait a moment and try again.`);
      setShowConfirm(false);
      return;
    }
    if (statusPending > 0) {
      setSubmitError('Still saving your last location — try again in a moment.');
      setShowConfirm(false);
      return;
    }
    if (savesPending > 0) {
      setSubmitError('Still saving your last count — try again in a moment.');
      setShowConfirm(false);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/inventory/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, status: 'submitted', staff_note: staffNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Submit failed.');
        setShowConfirm(false);
        return;
      }
      onSubmit();
    } catch (err) {
      console.error('Submit failed:', err);
      setSubmitError('Connection failed. Please try again.');
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-50"><Spinner /></div>;

  const canSubmit = session?.status === 'pending' || session?.status === 'in_progress';
  const isReadOnly = session?.status === 'submitted' || session?.status === 'approved' || session?.status === 'rejected';
  const locationName = session?.location_name || '';

  // Guided mode = the list has a real location route (spots). Kept for the
  // review/submit gating; the staff-facing view is chosen via viewMode.
  const guidedMode = !!route?.guided && canSubmit;

  // Staff choose how the count is organised: walk the LOCATIONS, bunch by
  // product GROUP (category), or a flat PRODUCT list. Only offer modes that fit
  // this list — Location needs spots, Group needs >1 category — and if the
  // chosen mode isn't available, fall back to the first that is.
  const canGroup = categories.length > 1;
  const availableModes = ([guidedMode ? 'location' : null, canGroup ? 'group' : null, 'product']
    .filter(Boolean)) as ('location' | 'group' | 'product')[];
  const effectiveMode = availableModes.includes(viewMode) ? viewMode : availableModes[0];
  const showCatGroups = effectiveMode === 'group' && categories.length > 1 && catFilter === 'all' && !search;

  // -- Count line row: one product at ONE spot --
  function ProductRow({ p, loc = 0, underSpot = false }: { p: any; loc?: number; underSpot?: boolean }) {
    const k = K(p.id, loc);
    const val = entries[k] ?? null;
    const uom = p.uom_id?.[1] || 'Units';
    const flagged = !!flags[p.id];
    const prodPhotos = rowPhotos[k] || [];
    const size = crateSizes[p.id];
    const isCrate = hasCrate(size);
    const words = unitWords(uom, crateLabels[p.id], looseLabels[p.id]);
    const label = words.pack;
    const measure = words.measure;
    // A product with a frozen chain is counted level by level, not as one pack
    // size plus loose — that is what the chain is FOR.
    const chain = countableLevels(packaging[p.id] || []);
    const nested = chain.length > 0;
    // The stored total is the truth. A remembered split is used only while it
    // still adds up to it, so it can never outlive the number it splits.
    const remembered = crateSplits[k];
    const split = (remembered && val != null && crateTotal(remembered.crates, remembered.loose, size) === val)
      ? remembered
      : (val != null ? splitFromTotal(val, size) : null);
    // Sibling lines: the SAME product counted at other spots — the double-count guard.
    const siblings = (spotsOfProduct.get(p.id) || []).filter((l) => l !== loc);
    return (
      <div className="py-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              {/* Wrap rather than truncate: "Beef, goula…" is useless to someone
                  holding the product. Two lines beat a cut-off name. */}
              <span className="text-[var(--fs-lg)] font-semibold text-gray-900 leading-snug min-w-0 [overflow-wrap:anywhere]">{p.name}</span>
              {/* The unit staff COUNT in — bunches, not the kilograms it converts
                  to. The conversion is the manager's business when ordering. */}
              <span className="text-[var(--fs-xs)] text-gray-400 flex-shrink-0">
                {isCrate && measure ? pluralizePack(label, 2) : words.loose}
              </span>
              {/* A pack of countable things still has to show its size, because
                  "3" means nothing until you know whether a crate is 12 or 24. */}
              {isCrate && !measure && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex-shrink-0">
                  1 {label} = {size} {words.looseFor(size)}
                </span>
              )}
              {/* What this restaurant wants to hold. Informational only — if
                  there really are 12, then 12 is the right answer and the count
                  records reality rather than arguing with it. */}
              {(() => {
                const pr = par[p.id];
                if (!pr || (pr.min == null && pr.max == null)) return null;
                const range = pr.min != null && pr.max != null ? `${pr.min}–${pr.max}`
                  : pr.min != null ? `at least ${pr.min}` : `at most ${pr.max}`;
                const low = pr.min != null && typeof val === 'number' && val < pr.min;
                return (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 border ${
                    low ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>
                    {low ? 'below par · ' : 'par '}{range}
                  </span>
                );
              })()}
              {flagged && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                  Photo required
                </span>
              )}
              {/* Everything about one product that is not a number: none left, a
                  note, a photo. It rides in this wrapping line rather than as a
                  fourth column, which left the name 20px on a small phone. */}
              {!isReadOnly && (
                <button
                  onClick={() => setRowMenu({ product: p, loc })}
                  aria-label={`More for ${p.name}`}
                  className="flex-shrink-0 h-7 min-w-[36px] px-2 -my-1 rounded-lg border border-gray-200 text-gray-500 text-[15px] font-bold leading-none active:bg-gray-50">
                  {'\u22EF'}
                </button>
              )}
              {/* In the walk, the shelf heading directly above already says where
                  you are — repeating it on every row is noise. The flat list has
                  no heading, so there it stays. */}
              {hasSpots && !underSpot && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border max-w-full break-words ${loc === 0 ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
                  {spotFullPath(loc)}
                </span>
              )}
            </div>
          </div>
          {/* Three ways to enter a number, by what the product actually IS.
              A measured product sold in bunches is just a stepper counting
              bunches — there is no such thing as half a loose bunch, so the old
              modal was one stepper wrapped in arithmetic. Countable things in
              packs genuinely need two numbers (3 crates AND 5 loose bottles),
              so those still open the sheet — by tapping the number, not a
              separate button. Everything else is a plain stepper. */}
          {isReadOnly ? (
            <div className="text-[var(--fs-lg)] font-mono font-semibold text-gray-700 text-right">
              {val !== null ? val : '--'} <span className="text-[var(--fs-xs)] text-gray-400">{words.loose}</span>
              {isCrate && split && val !== null && (
                <div className="text-[10px] text-gray-400 font-normal font-mono">{formatSplit(split.crates, split.loose, words.loose, label)}</div>
              )}
            </div>
          ) : nested ? (
            <button
              onClick={() => { setDraftNote(rowNotes[k] || ''); setPackSheet({ open: true, product: p, loc }); }}
              className={`flex-shrink-0 text-right border rounded-xl px-3 py-2 min-w-[104px] active:bg-gray-50 ${val != null ? 'border-green-500 bg-green-50' : 'border-dashed border-gray-300'}`}
            >
              {val != null ? (
                <>
                  <div className="font-mono text-[var(--fs-lg)] font-bold text-gray-900 leading-none">
                    {val}<span className="text-[10px] font-semibold text-gray-500 ml-0.5">{words.looseFor(val)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 font-mono">
                    {chain.map((l) => `${packSplits[k]?.byLevel?.[l.id] ?? 0} ${l.name}`).join(' + ')}
                  </div>
                </>
              ) : (
                <div className="text-[var(--fs-sm)] font-bold text-green-700">
                  {chain.map((l) => pluralizePack(l.name, 2)).join(' + ')} {'\u2192'}
                </div>
              )}
            </button>
          ) : isCrate && measure ? (
            <Stepper
              value={split ? split.crates : null}
              uom={pluralizePack(label, split?.crates ?? 2)}
              onMinus={() => stepPacks(p, loc, -1)}
              onPlus={() => stepPacks(p, loc, 1)}
              onTap={() => openCrateSheet(p, loc)} />
          ) : isCrate ? (
            <button
              onClick={() => openCrateSheet(p, loc)}
              className={`flex-shrink-0 text-right border rounded-xl px-3 py-2 min-w-[94px] active:bg-gray-50 ${val != null ? 'border-green-500 bg-green-50' : 'border-dashed border-gray-300'}`}
            >
              {val != null && split ? (
                <>
                  <div className="font-mono text-[var(--fs-lg)] font-bold text-gray-900 leading-none">
                    {split.crates}<span className="text-[10px] font-semibold text-gray-500 ml-0.5">{pluralizePack(label, split.crates)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 font-mono">
                    + {split.loose} {words.looseFor(split.loose)}
                  </div>
                </>
              ) : (
                <div className="text-[var(--fs-sm)] font-bold text-green-700">
                  {pluralizePack(label, 2)} + {words.looseFor(2)} {'\u2192'}
                </div>
              )}
            </button>
          ) : (
            <Stepper value={val} uom={words.loose}
              onMinus={() => stepQty(p, loc, -1)}
              onPlus={() => stepQty(p, loc, 1)}
              onTap={() => openNumpad(p, loc)} />
          )}
        </div>
        {siblings.length > 0 && (
          <p className="mt-1.5 text-[11px] text-gray-500 leading-snug">
            <span className="font-semibold text-gray-600">Also in:</span>{' '}
            {siblings.map((sl) => spotFullPath(sl)).join(' \u00B7 ')}
          </p>
        )}
        {/* The manager's standing note about this product, as distinct from what
            the counter writes about today. This is the whole reason the field
            exists — a note nobody reads while counting is a note wasted. */}
        {plainFromOdooHtml(p.description) && (
          <p className="mt-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 leading-snug whitespace-pre-wrap">
            {plainFromOdooHtml(p.description)}
          </p>
        )}
        {rowNotes[k] && (
          <p className="mt-2 text-[var(--fs-xs)] text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 leading-snug">
            📝 {rowNotes[k]}
          </p>
        )}
        {oos.has(k) && (
          <div className="mt-2">
            {/* Marking "nothing here" now happens INSIDE the count sheet; the row
                only reports it, so a deliberate none still reads differently
                from a counted 0. */}
            <span className="inline-block text-[11px] font-bold rounded-full px-2.5 py-1 border text-red-600 border-red-200 bg-red-50">
              {'\u2713'} {hasSpots ? 'Nothing at this spot' : 'Nothing here'}
            </span>
          </div>
        )}
        {/* Answered, but the quantity is unknown — visibly NOT the same thing as
            a zero, because the stock consequence is the opposite. */}
        {notFound.has(k) && (
          <div className="mt-2">
            <span className="inline-block text-[11px] font-bold rounded-full px-2.5 py-1 border text-amber-800 border-amber-200 bg-amber-50">
              {'\u2713'} Couldn’t find it {'\u00B7'} stock left alone
            </span>
          </div>
        )}
        {flagged && !isReadOnly && (val ?? 0) > 0 && (
          <div className="mt-2">
            <PhotoCaptureStrip
              photos={prodPhotos}
              onChange={(next) => savePhotos(p, loc, next)}
            />
          </div>
        )}
      </div>
    );
  }

  // -- Scan button (count header, top-right) --
  // Lives in the header, not a floating FAB, so it can never sit on top of a
  // product row's Count / Mark-out-of-stock control (the old FAB overlapped them).
  const scanButton = !isReadOnly ? (
    <button
      onClick={() => setShowScanner(true)}
      className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-[#2563EB] active:bg-blue-50 transition-colors"
      aria-label="Scan barcode"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 7V5a2 2 0 012-2h2"/>
        <path d="M17 3h2a2 2 0 012 2v2"/>
        <path d="M21 17v2a2 2 0 01-2 2h-2"/>
        <path d="M7 21H5a2 2 0 01-2-2v-2"/>
        <line x1="7" y1="12" x2="17" y2="12"/>
        <line x1="7" y1="8" x2="10" y2="8"/>
        <line x1="14" y1="8" x2="17" y2="8"/>
        <line x1="7" y1="16" x2="10" y2="16"/>
        <line x1="14" y1="16" x2="17" y2="16"/>
      </svg>
    </button>
  ) : null;

  // ============================
  // REVIEW VIEW
  // ============================
  if (view === 'review') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <button onClick={() => setView('counting')} className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Edit counts
            </button>
          </div>
          <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Review count</h1>
          <p className="text-[var(--fs-sm)] text-gray-500 mt-0.5">{session?.template_name} {'\u00B7'} {session?.scheduled_date}</p>
        </div>

        <OfflineBanner sync={sync} />
      {saveError && (
        <div role="alert" className="mx-4 mt-2 mb-1 rounded-xl bg-red-50 border border-red-300 px-3 py-2.5 flex items-start gap-2">
          <span aria-hidden="true" className="text-red-600 font-bold">!</span>
          <div className="min-w-0 flex-1">
            <p className="text-[var(--fs-sm)] font-bold text-red-800">Not saved</p>
            <p className="text-[var(--fs-xs)] text-red-700 leading-snug [overflow-wrap:anywhere]">{saveError}</p>
            <p className="text-[var(--fs-xs)] text-red-700 mt-0.5">The line has been put back the way it was.</p>
          </div>
          <button onClick={() => setSaveError(null)} aria-label="Dismiss"
            className="flex-shrink-0 w-7 h-7 rounded-lg text-red-700 font-bold active:bg-red-100">×</button>
        </div>
      )}
              {saveError && (
        <div role="alert" className="mx-4 mt-2 mb-1 rounded-xl bg-red-50 border border-red-300 px-3 py-2.5 flex items-start gap-2">
          <span aria-hidden="true" className="text-red-600 font-bold">!</span>
          <div className="min-w-0 flex-1">
            <p className="text-[var(--fs-sm)] font-bold text-red-800">Not saved</p>
            <p className="text-[var(--fs-xs)] text-red-700 leading-snug [overflow-wrap:anywhere]">{saveError}</p>
            <p className="text-[var(--fs-xs)] text-red-700 mt-0.5">The line has been put back the way it was.</p>
          </div>
          <button onClick={() => setSaveError(null)} aria-label="Dismiss"
            className="flex-shrink-0 w-7 h-7 rounded-lg text-red-700 font-bold active:bg-red-100">×</button>
        </div>
      )}
      
        <div className="px-4 pt-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[var(--fs-lg)] font-bold text-gray-900">Count summary</span>
              <span className="text-[var(--fs-sm)] font-mono text-gray-500">{countedCount}/{totalCount}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all ${countedCount === totalCount ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${totalCount > 0 ? (countedCount / totalCount) * 100 : 0}%` }} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 rounded-xl p-3 text-center">
                <div className="text-[var(--fs-xxl)] font-bold text-green-700 font-mono">{countedCount}</div>
                <div className="text-[var(--fs-xs)] text-green-600 font-semibold">Counted</div>
              </div>
              <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-[var(--fs-xxl)] font-bold text-amber-700 font-mono">{uncountedLines.length}</div>
                <div className="text-[var(--fs-xs)] text-amber-600 font-semibold">Uncounted</div>
              </div>
            </div>
          </div>

          {uncountedLines.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-3">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-600 mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </span>
                <div>
                  <p className="text-[var(--fs-base)] font-semibold text-amber-800">
                    {uncountedLines.length} item{uncountedLines.length > 1 ? 's' : ''} not counted
                  </p>
                  <p className="text-[var(--fs-xs)] text-amber-700 mt-0.5">
                    Uncounted items will be submitted as not counted. You can go back and count them.
                  </p>
                </div>
              </div>
            </div>
          )}

          {canSubmit && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-3">
              <label htmlFor="staff-note" className="block text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-2">
                📝 Anything the manager should know?
              </label>
              <textarea id="staff-note" value={staffNote} onChange={(e) => setStaffNote(e.target.value)}
                rows={3} placeholder="e.g. basement fridge room was locked — nothing counted in there"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[var(--fs-base)] text-gray-900 outline-none focus:border-green-500 resize-none" />
              <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">Optional — shown at the top of their review.</p>
            </div>
          )}

          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-3">
              <p className="text-[var(--fs-base)] font-semibold text-red-700">{submitError}</p>
            </div>
          )}

        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-36">
          {countedLines.length > 0 && (
            <>
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Counted items</p>
              {countedLines.map((l) => {
                const p = productsById[l.pid] || { id: l.pid, name: `#${l.pid}` };
                const k = K(l.pid, l.loc);
                const val = entries[k];
                const uom = p.uom_id?.[1] || 'Units';
                const size = crateSizes[p.id];
                const isCrate = hasCrate(size);
                const words = unitWords(uom, crateLabels[p.id], looseLabels[p.id]);
                const label = words.pack;
                // The stored total is the truth. A remembered split is used only while it
                // still adds up to it, so it can never outlive the number it splits.
                const remembered = crateSplits[k];
                const split = (remembered && val != null && crateTotal(remembered.crates, remembered.loose, size) === val)
                  ? remembered
                  : (val != null ? splitFromTotal(val, size) : null);
                return (
                  <div key={k} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                    <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 self-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </div>
                      <span className="text-[var(--fs-lg)] text-gray-900 truncate">{p.name}</span>
                      {hasSpots && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border max-w-full break-words ${l.loc === 0 ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>{spotFullPath(l.loc)}</span>
                      )}
                    </div>
                    <div className="flex-shrink-0 ml-3 text-right">
                      <span className="text-[var(--fs-lg)] font-mono font-semibold text-gray-900">
                        {val} <span className="text-[var(--fs-xs)] text-gray-400 font-normal">{uom}</span>
                      </span>
                      {isCrate && split && (
                        <div className="text-[10px] text-gray-400 font-mono">{formatSplit(split.crates, split.loose, words.loose, label)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {uncountedLines.length > 0 && (
            <>
              <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-4 mb-2">Not counted</p>
              {uncountedLines.map((l) => {
                const p = productsById[l.pid] || { id: l.pid, name: `#${l.pid}` };
                const uom = p.uom_id?.[1] || 'Units';
                return (
                  <div key={K(l.pid, l.loc)} className="flex items-center justify-between py-2.5 border-b border-gray-100 opacity-50">
                    <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 self-center">
                        <span className="text-gray-400 text-[var(--fs-xs)] font-bold">--</span>
                      </div>
                      <span className="text-[var(--fs-lg)] text-gray-500 truncate">{p.name}</span>
                      {hasSpots && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border max-w-full break-words ${l.loc === 0 ? 'bg-gray-50 text-gray-500 border-gray-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>{spotFullPath(l.loc)}</span>
                      )}
                    </div>
                    <span className="text-[var(--fs-sm)] text-gray-400 flex-shrink-0 ml-3">-- {uom}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {canSubmit && (
          <div className="px-4 py-3">
            <button onClick={() => setShowConfirm(true)} disabled={submitting || (countedCount === 0 && !guidedMode)}
              className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all disabled:opacity-50">
              Submit for approval
            </button>
          </div>
        )}

        {showConfirm && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-end justify-center">
            <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8">
              <h3 className="text-[var(--fs-xl)] font-bold text-gray-900 mb-2">Submit this count?</h3>
              <p className="text-[var(--fs-base)] text-gray-500 mb-1">
                {countedCount} of {totalCount} items counted.
                {uncountedLines.length > 0 && ` ${uncountedLines.length} item${uncountedLines.length > 1 ? 's' : ''} will be marked as not counted.`}
              </p>
              <p className="text-[var(--fs-base)] text-gray-500 mb-5">
                You will not be able to edit after submitting. A manager will review your count.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[var(--fs-sm)] font-bold active:bg-gray-200">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Yes, submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================
  // COUNTING VIEW
  // ============================
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onBack}
        title={session?.template_name || `Session #${sessionId}`}
        subtitle={`${locationName ? locationName + ' \u00B7 ' : ''}${totalCount} ${hasSpots ? 'count lines' : 'products'}`}
        right={scanButton}
      />

      <OfflineBanner sync={sync} />

      {availableModes.length > 1 && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1" role="tablist" aria-label="How to organise the count">
            {availableModes.map((m) => (
              <button key={m} role="tab" aria-selected={effectiveMode === m} onClick={() => setViewMode(m)}
                className={`flex-1 py-2 rounded-lg text-[var(--fs-sm)] font-bold transition ${
                  effectiveMode === m ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 active:text-gray-700'}`}>
                {m === 'location' ? '📍 Location' : m === 'group' ? '🗂️ Group' : '📦 Product'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sticky progress: how much is left and where you are, without scrolling. */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 pt-2 pb-2.5">
        <div className="flex items-center justify-between text-[var(--fs-xs)] font-bold text-gray-500 mb-1.5">
          <span>{countedCount} of {totalCount} counted</span>
          {nextLine && (
            <span className="text-green-700 truncate ml-2">
              Next: {hasSpots ? spotLabel(nextLine.loc) : (productsById[nextLine.pid]?.name || '')}
            </span>
          )}
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-green-600 rounded-full transition-all"
            style={{ width: `${totalCount > 0 ? (countedCount / totalCount) * 100 : 0}%` }} />
        </div>
      </div>

      {effectiveMode === 'location' && route ? (
        <GuidedCountingFlow
          stops={route.stops}
          productsById={productsById}
          statuses={guidedStatuses}
          renderRow={(p, bucketId) => <ProductRow p={p} loc={items.length > 0 ? bucketId : 0} underSpot />}
          stopProgress={(bucketId, ids) => {
            // Legacy sessions store every line at the catch-all spot, so their
            // walk buckets read progress from loc 0.
            const loc = items.length > 0 ? bucketId : 0;
            return { counted: ids.filter((id) => entries[K(id, loc)] !== undefined).length, total: ids.length };
          }}
          onUnskipStop={(b) => postStopStatus(b, 'pending', null)}
          onSkipStop={(b, r) => postStopStatus(b, 'skipped', r)}
          onReview={() => setView('review')}
        />
      ) : (
        <>
      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <FilterBar>
        <FilterPill active={statusFilter === 'all'} label="All" count={totalCount} onClick={() => setStatusFilter('all')} />
        <FilterPill active={statusFilter === 'uncounted'} label="Uncounted" count={totalCount - countedCount} onClick={() => setStatusFilter('uncounted')} />
        <FilterPill active={statusFilter === 'counted'} label="Counted" count={countedCount} onClick={() => setStatusFilter('counted')} />
      </FilterBar>

      {categories.length > 1 && (
        <FilterBar>
          <FilterPill active={catFilter === 'all'} label="All" onClick={() => setCatFilter('all')} />
          {categories.map((c) => (
            <FilterPill key={c.id} active={catFilter === c.leaf} label={c.leaf} onClick={() => setCatFilter(c.leaf)} />
          ))}
        </FilterBar>
      )}

      <CountProgress counted={countedCount} total={totalCount} />

      <div className="flex-1 overflow-y-auto px-4 pb-36">
        {totalCount === 0 ? (
          <EmptyState title="No products configured" body="This counting list has no products. Ask your manager to edit the template." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products match" body="Try a different filter or search term" />
        ) : showCatGroups ? (
          /* Grouped by category */
          <div className="flex flex-col">
            {grouped.map((group) => (
              <div key={group.catName}>
                <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 pt-4 pb-2">
                  {group.catName}
                </div>
                {group.items.map((l) => <ProductRow key={K(l.pid, l.loc)} p={productsById[l.pid]} loc={l.loc} />)}
              </div>
            ))}
          </div>
        ) : (
          /* Flat list (when filtered by category or searching) */
          <div className="flex flex-col">
            {filteredLines.map((l) => <ProductRow key={K(l.pid, l.loc)} p={productsById[l.pid]} loc={l.loc} />)}
          </div>
        )}
      </div>

      {canSubmit && countedCount > 0 && (
        <div className="px-4 py-3">
          <button onClick={() => setView('review')}
            className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Review count ({countedCount}/{totalCount})
          </button>
        </div>
      )}
        </>
      )}

      {isReadOnly && (
        <div className="px-4 py-3 bg-gray-100 rounded-xl">
          <p className="text-center text-[var(--fs-base)] text-gray-500 font-semibold">
            {session?.status === 'submitted' ? 'Submitted \u2014 awaiting review' : session?.status === 'approved' ? 'Approved' : 'Rejected'}
          </p>
        </div>
      )}

      {spotChoice && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center" onClick={() => setSpotChoice(null)}>
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Which spot?</h3>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-3">{spotChoice.product.name} is counted at several spots {'\u2014'} where is this {spotChoice.qty}?</p>
            {(spotsOfProduct.get(spotChoice.product.id) || []).map((sl) => {
              const cur = entries[K(spotChoice.product.id, sl)];
              return (
                <button key={sl}
                  onClick={() => { saveCount(spotChoice.product.id, sl, spotChoice.qty, spotChoice.uom); setSpotChoice(null); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border border-gray-200 font-semibold mb-2 active:bg-gray-50">
                  <span className="text-left break-words min-w-0">{spotFullPath(sl)}</span>
                  <span className="text-[var(--fs-sm)] text-gray-400 font-mono">{cur !== undefined ? `${cur} \u2713` : '\u2014'}</span>
                </button>
              );
            })}
            <button onClick={() => setSpotChoice(null)} className="w-full py-3.5 rounded-xl bg-gray-100 font-bold mt-1">Cancel</button>
          </div>
        </div>
      )}

      <BarcodeScanner
        open={showScanner}
        onClose={() => { setShowScanner(false); setHwBarcode(undefined); }}
        products={products}
        entries={productTotals}
        totalCount={totalCount}
        countedCount={countedCount}
        onCount={handleScanCount}
        userRole={userRole}
        title="Scan product"
        pendingBarcode={hwBarcode}
        onPendingConsumed={() => setHwBarcode(undefined)}
      />

      {!isReadOnly && (
        <NumpadModal
          note={draftNote}
          onNoteChange={setDraftNote}
          outOfStock={numpad.product ? oos.has(K(numpad.product.id, numpad.loc)) : false}
          nothingHereLabel={hasSpots ? 'Nothing at this spot' : 'Nothing here'}
          onNothingHere={(on) => {
            if (numpad.product) saveOutOfStock(numpad.product, numpad.loc, on, draftNote);
            setNumpad({ open: false, product: null, loc: 0 });
          }}
          open={numpad.open}
          productName={numpad.product?.name || ''}
          category={numpad.product?.categ_id?.[1] || ''}
          uom={numpad.product?.uom_id?.[1] || 'Units'}
          initialValue={numpad.product ? (entries[K(numpad.product.id, numpad.loc)] ?? null) : null}
          showSystemQty={userRole !== 'staff'}
          systemQty={numpad.product ? (systemQtys[numpad.product.id] ?? null) : null}
          locationName={locationName}
          onSave={handleNumpadSave}
          onClose={() => setNumpad({ open: false, product: null, loc: 0 })}
        />
      )}

      {/* Per-product actions. A sheet rather than a dropdown: it is reachable
          with a thumb at the bottom of a phone, and it names what each choice
          does instead of hiding it behind an icon. */}
      {!isReadOnly && rowMenu && (() => {
        const rk = K(rowMenu.product.id, rowMenu.loc);
        const isNone = oos.has(rk);
        const close = () => setRowMenu(null);
        return (
          <div className="fixed inset-0 z-[100] flex items-end" role="dialog" aria-modal="true">
            <button aria-label="Close" onClick={close} className="absolute inset-0 bg-black/40" />
            <div className="relative w-full bg-white rounded-t-3xl pb-[env(safe-area-inset-bottom)] max-h-[90vh] overflow-y-auto">
              <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                <div className="text-[var(--fs-lg)] font-bold text-gray-900 leading-snug">{rowMenu.product.name}</div>
                {hasSpots && <div className="text-[var(--fs-xs)] text-gray-500 font-semibold mt-0.5">{spotLabel(rowMenu.loc)}</div>}
              </div>
              <button onClick={() => {
                  // A pack line's number lives in the crate sheet. Sending it to
                  // the base keypad let someone type "3" meaning three crates
                  // and save three BOTTLES — a 24x error, invisible on this row.
                  if (hasCrate(crateSizes[rowMenu.product.id])) openCrateSheet(rowMenu.product, rowMenu.loc);
                  else openNumpad(rowMenu.product, rowMenu.loc);
                  close();
                }}
                className="w-full flex items-center gap-3 px-5 py-4 border-b border-gray-100 text-left active:bg-gray-50">
                <span className="text-[18px]" aria-hidden="true">📝</span>
                <span className="text-[var(--fs-base)] font-semibold text-gray-900">
                  {rowNotes[rk] ? 'Edit the note' : 'Add a note'}
                </span>
              </button>
              {(entries[rk] ?? 0) > 0 && (
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[18px]" aria-hidden="true">📷</span>
                    <span className="text-[var(--fs-base)] font-semibold text-gray-900">Photo</span>
                  </div>
                  <PhotoCaptureStrip
                    photos={rowPhotos[rk] || []}
                    onChange={async (next) => { await savePhotos(rowMenu.product, rowMenu.loc, next); }}
                  />
                </div>
              )}
              <button onClick={() => { void saveOutOfStock(rowMenu.product, rowMenu.loc, !isNone); close(); }}
                className="w-full flex items-center gap-3 px-5 py-4 border-b border-gray-100 text-left active:bg-gray-50">
                <span className="text-[18px]" aria-hidden="true">{isNone ? '↩️' : '🚫'}</span>
                <span className="min-w-0">
                  <span className={`block text-[var(--fs-base)] font-semibold ${isNone ? 'text-gray-900' : 'text-red-600'}`}>
                    {isNone ? 'There is some here after all' : (hasSpots ? 'None left at this spot' : 'None left here')}
                  </span>
                  {!isNone && (
                    <span className="block text-[var(--fs-xs)] text-gray-500">I looked — there is none. Records zero.</span>
                  )}
                </span>
              </button>
              {/* The THIRD answer. Deliberately separate from "none left": that
                  one records a real zero, this one records "I do not know" and
                  leaves your stock alone. */}
              {(() => {
                const isNf = notFound.has(rk);
                return (
                  <button onClick={() => { void saveNotFound(rowMenu.product, rowMenu.loc, !isNf); close(); }}
                    className="w-full flex items-center gap-3 px-5 py-4 border-b border-gray-100 text-left active:bg-gray-50">
                    <span className="text-[18px]" aria-hidden="true">{isNf ? '↩️' : '🔎'}</span>
                    <span className="min-w-0">
                      <span className={`block text-[var(--fs-base)] font-semibold ${isNf ? 'text-gray-900' : 'text-amber-700'}`}>
                        {isNf ? 'Found it after all' : 'Couldn’t find it'}
                      </span>
                      {!isNf && (
                        <span className="block text-[var(--fs-xs)] text-gray-500">
                          Not where it should be. Your stock is left alone and the manager is told.
                        </span>
                      )}
                    </span>
                  </button>
                );
              })()}
              <button onClick={close} className="w-full px-5 py-4 text-[var(--fs-base)] font-bold text-gray-500 active:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {!isReadOnly && packSheet.open && packSheet.product && (() => {
        const pk = K(packSheet.product.id, packSheet.loc);
        const levels = packaging[packSheet.product.id] || [];
        const remembered = packSplits[pk];
        // No remembered split (counted by barcode, or on another device)? Derive
        // one from the stored total so the sheet opens on what is actually there.
        const derived = remembered || splitToLevels(entries[pk] ?? 0, levels);
        return (
          <PackCountSheet
            open
            product={packSheet.product}
            levels={levels}
            uom={packSheet.product.uom_id?.[1] || 'Units'}
            looseLabel={looseLabels[packSheet.product.id] || null}
            initialByLevel={derived.byLevel || {}}
            initialLoose={derived.loose || 0}
            locationName={hasSpots ? spotLabel(packSheet.loc) : (locationName || '')}
            showSystemQty={userRole !== 'staff'}
            systemQty={systemQtys[packSheet.product.id] ?? null}
            outOfStock={oos.has(pk)}
            nothingHereLabel={hasSpots ? 'Nothing at this spot' : 'Nothing here'}
            onNothingHere={(on) => {
              void saveOutOfStock(packSheet.product, packSheet.loc, on, draftNote);
              setPackSheet({ open: false, product: null, loc: 0 });
            }}
            note={draftNote}
            onNoteChange={setDraftNote}
            onSave={(byLevel, loose) => {
              const had = rowNotes[pk] || '';
              void savePackCount(packSheet.product, packSheet.loc, byLevel, loose, draftNote !== had ? draftNote : undefined);
            }}
            onClose={() => setPackSheet({ open: false, product: null, loc: 0 })}
          />
        );
      })()}

      {!isReadOnly && crateSheet.open && crateSheet.product && (
        <CrateCountSheet
          note={draftNote}
          onNoteChange={setDraftNote}
          outOfStock={oos.has(K(crateSheet.product.id, crateSheet.loc))}
          nothingHereLabel={hasSpots ? 'Nothing at this spot' : 'Nothing here'}
          onNothingHere={(on) => {
            saveOutOfStock(crateSheet.product, crateSheet.loc, on, draftNote);
            setCrateSheet({ open: false, product: null, loc: 0 });
          }}
          open={crateSheet.open}
          product={crateSheet.product}
          unitsPerCrate={crateSizes[crateSheet.product.id] || 0}
          uom={crateSheet.product.uom_id?.[1] || 'Units'}
          packLabel={unitWords(crateSheet.product.uom_id?.[1], crateLabels[crateSheet.product.id], looseLabels[crateSheet.product.id]).pack}
          looseLabel={looseLabels[crateSheet.product.id] || null}
          initialCrates={crateSplits[K(crateSheet.product.id, crateSheet.loc)]?.crates ?? splitFromTotal(entries[K(crateSheet.product.id, crateSheet.loc)] ?? 0, crateSizes[crateSheet.product.id]).crates}
          initialLoose={crateSplits[K(crateSheet.product.id, crateSheet.loc)]?.loose ?? splitFromTotal(entries[K(crateSheet.product.id, crateSheet.loc)] ?? 0, crateSizes[crateSheet.product.id]).loose}
          showSystemQty={userRole !== 'staff'}
          systemQty={systemQtys[crateSheet.product.id] ?? null}
          locationName={locationName}
          onSave={(crates, loose) => {
            const had = rowNotes[K(crateSheet.product.id, crateSheet.loc)] || '';
            saveCrateCount(crateSheet.product, crateSheet.loc, crates, loose, draftNote !== had ? draftNote : undefined);
            setDraftNote('');
          }}
          onClose={() => setCrateSheet({ open: false, product: null, loc: 0 })}
        />
      )}
    </div>
  );
}
