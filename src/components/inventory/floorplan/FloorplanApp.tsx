'use client';
/**
 * Inventory Floorplan — client root of /inventory/floorplan.
 *
 * Owns the load lifecycle (request token so only the latest response writes
 * state — Design Principle 4), floor selection (last floor remembered per
 * company), type filtering, selection + fly-to, the spot sheet, and the
 * deep-link entry (?spot=<id> from QR stickers and "Show on map").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { CompanyPill } from '@/components/ui/CompanyPill';
import { allowedActionKeysForRole } from '@/lib/permissions';
import type { FloorplanManifest, FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';
import { cacheFloorplan, getCachedFloorplan } from '@/lib/inventory-floorplan/offline';
import { pointInPolygon } from '@/lib/inventory-floorplan/geometry';
import { filterByType } from '@/lib/inventory-floorplan/marker-presets';
import type { Pt } from '@/lib/inventory-floorplan/types';
import FloorplanMap, { type FlyTarget } from './FloorplanMap';
import FloorplanSearch from './FloorplanSearch';
import FloorplanSpotSheet from './FloorplanSpotSheet';
import { useTopBar } from '@/components/ui/TopBarContext';

interface ManifestResponse {
  manifest: FloorplanManifest | null;
  focus: { locationId: number; floorId: number; cx: number; cy: number } | null;
  focusMissing: boolean;
}

export interface FloorplanAppProps {
  /** Overlay mode (counting): focus this spot, hide back-navigation chrome. */
  focusLocationId?: number;
  onClose?: () => void;
}

export default function FloorplanApp({ focusLocationId, onClose }: FloorplanAppProps) {
  const router = useRouter();
  const stateClass = onClose ? 'flex h-full flex-col bg-gray-50' : 'flex min-h-screen flex-col bg-gray-50';
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [resp, setResp] = useState<ManifestResponse | null>(null);
  const [activeFloorId, setActiveFloorId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  /**
   * Type chips. A FILTER, not a highlight: what is picked is what the plan
   * shows. Several can be on at once, and each toggles on its own — empty is
   * the "All" state.
   */
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>(() => allowedActionKeysForRole('staff', {}));
  const [edit, setEdit] = useState(false);
  /**
   * Editing a plan is precision work, and the plan was getting the smaller
   * half of the screen: app bar, page header, search, filters, the type strip
   * and a hint all stacked above it. Edit mode therefore goes IMMERSIVE —
   * fixed to the whole viewport, over the global chrome, with the page header
   * and search dropped. Same rule the recipe screens already follow
   * (feedback_immersive_views): a focused work screen owns the screen.
   *
   * Only for the real page. In counting's overlay (onClose) the parent already
   * owns the frame, so taking over the viewport there would break out of it.
   */
  const immersive = edit && !onClose;
  // Hide the global bars the way every other immersive screen does — the count
  // flow, KDS and the cook timer all use this. It UNMOUNTS the chrome rather
  // than covering it, which matters: a fixed overlay of our own would also
  // paint over the shared-device PIN gate, and an expired session would then
  // look like a frozen plan you cannot sign back into.
  const { setHidden: setChromeHidden } = useTopBar();
  useEffect(() => {
    // In counting's overlay the PARENT owns the chrome and has already hidden
    // it. Touching the shared flag from in here would switch it back on behind
    // that overlay, and our cleanup would leave it on afterwards.
    if (onClose) return;
    setChromeHidden(immersive);
    return () => setChromeHidden(false);
  }, [immersive, onClose, setChromeHidden]);
  const rootClass = onClose
    ? 'flex h-full flex-col overflow-hidden bg-gray-50'
    // fixed, because this route's <main> reserves pt-9/pb-20 for the very bars
    // we just unmounted — inside that padding a 100dvh box overflows the page.
    // z-130 clears the app chrome (max z-120) and stays UNDER the shared-device
    // PIN gate at z-200, which must always be able to paint over us.
    : immersive
      ? 'fixed inset-0 z-[130] flex h-[100dvh] flex-col overflow-hidden bg-gray-50'
      : 'flex h-[calc(100dvh-7.25rem)] flex-col overflow-hidden bg-gray-50';
  const [armed, setArmed] = useState<string | null>(null);
  const [showEditHint, setShowEditHint] = useState(true);
  const [addForm, setAddForm] = useState<{ x: number; y: number; code: string; roomId: number | null; existingId: number | null } | null>(null);
  const [treeLocations, setTreeLocations] = useState<Array<{ id: number; name: string; parent_id: number | null; kind: string }>>([]);
  const [editSel, setEditSel] = useState<{ anchorId: number; locationId: number; label: string } | null>(null);
  /** Open confirm for a marker being removed — see the two meanings of Remove. */
  const [removeAsk, setRemoveAsk] = useState<{ anchorId: number; locationId: number; label: string } | null>(null);
  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [offlineFrom, setOfflineFrom] = useState<string | null>(null);
  const [offlineRasters, setOfflineRastersRaw] = useState<Record<number, string>>({});
  // Object URLs hold their blobs alive until revoked — always release the
  // previous set when replacing, and everything on unmount (audit finding).
  const setOfflineRasters = useCallback((next: Record<number, string>) => {
    setOfflineRastersRaw(prev => {
      for (const url of Object.values(prev)) { if (!Object.values(next).includes(url)) URL.revokeObjectURL(url); }
      return next;
    });
  }, []);
  useEffect(() => () => {
    setOfflineRastersRaw(prev => { for (const url of Object.values(prev)) URL.revokeObjectURL(url); return {}; });
  }, []);
  const tokenRef = useRef(0);
  const treeTokenRef = useRef(0);
  const seqRef = useRef(0);
  const userIdRef = useRef<number | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (Array.isArray(d.user?.capabilities)) setCapabilities(d.user.capabilities);
      if (typeof d.user?.id === 'number') { setUserId(d.user.id); userIdRef.current = d.user.id; }
    }).catch(() => { /* keep staff defaults */ });
  }, []);

  const load = useCallback(() => {
    const token = ++tokenRef.current;
    // Only the FIRST load may show the full-screen loading state. A refresh
    // after placing/moving must keep the map mounted — otherwise Leaflet is
    // destroyed and rebuilt, snapping the view back to the whole plan and
    // undoing the zoom you were working at.
    setState(prev => (prev === 'ready' ? 'ready' : 'loading'));
    // ?spot= deep link (QR sticker / "Show on map") or overlay focus prop.
    let spotParam = focusLocationId != null ? String(focusLocationId) : null;
    if (spotParam == null && typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('spot');
      if (q && /^\d+$/.test(q)) spotParam = q;
    }
    const url = spotParam ? `/api/inventory/floorplan?spot=${spotParam}` : '/api/inventory/floorplan';
    fetch(url)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (tokenRef.current !== token) return;
        if (!ok) { setState('error'); return; }
        const data = d as ManifestResponse;
        // A reload can mean a COMPANY switch — stale selection/sheet/edit state
        // must never point into the previous restaurant's spots.
        setResp(prev => {
          if (prev?.manifest && data.manifest && prev.manifest.companyId !== data.manifest.companyId) {
            setSelectedId(null); setSheetId(null); setFilterTypes([]);
            setEdit(false); setEditSel(null); setArmed(null); setAddForm(null);
            // A delete confirmation still open here would be aimed at the spot
            // of the restaurant we just left.
            setRemoveAsk(null); setRemoveErr(null);
          }
          return data;
        });
        setState('ready');
        setOfflineFrom(null);
        setOfflineRasters({});
        const floors = data.manifest?.floors.filter(f => f.revision) ?? [];
        let floorId: number | null = null;
        if (data.focus) floorId = data.focus.floorId;
        else if (typeof window !== 'undefined' && data.manifest) {
          const remembered = parseInt(window.localStorage.getItem(`kw_fp_floor_${data.manifest.companyId}`) ?? '0', 10);
          if (floors.some(f => f.id === remembered)) floorId = remembered;
        }
        if (floorId == null) floorId = floors[0]?.id ?? null;
        setActiveFloorId(floorId);
        if (data.focus) {
          setSelectedId(data.focus.locationId);
          setSheetId(data.focus.locationId);
          setFlyTo({ cx: data.focus.cx, cy: data.focus.cy, seq: ++seqRef.current });
        } else if (data.focusMissing && spotParam) {
          // Not on the plan (a drawer inside a fridge never gets its own
          // marker, and a QR can point at one) — still SHOW the place: its
          // contents, its products, its photo. The banner explains the rest.
          setSheetId(parseInt(spotParam, 10));
        }
      })
      .catch(async () => {
        if (tokenRef.current !== token) return;
        // No network — fall back to the last complete snapshot for this
        // user+company (opened at least once online), clearly labelled.
        const cookieCompany = typeof document !== 'undefined'
          ? parseInt((document.cookie.match(/(?:^|; )kw_company_id=(\d+)/) || [])[1] ?? '0', 10)
          : 0;
        const uid = userIdRef.current;
        if (uid && cookieCompany) {
          const cached = await getCachedFloorplan(uid, cookieCompany);
          if (tokenRef.current === token && cached) {
            setResp({ manifest: cached.manifest, focus: null, focusMissing: false });
            setOfflineRasters(cached.rasterUrls);
            setOfflineFrom(cached.cachedAt);
            setState('ready');
            const floors = cached.manifest.floors.filter(f => f.revision);
            setActiveFloorId(floors[0]?.id ?? null);
            return;
          }
        }
        if (tokenRef.current === token) setState('error');
      });
  }, [focusLocationId]);

  useEffect(() => { load(); }, [load]);

  // After a successful ONLINE load, snapshot the plan for offline use.
  useEffect(() => {
    if (state === 'ready' && resp?.manifest && userId && !offlineFrom) {
      void cacheFloorplan(userId, resp.manifest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resp?.manifest, userId, offlineFrom]);

  const manifest = resp?.manifest ?? null;
  const typesByKey = useMemo(() => {
    const m: Record<string, FloorplanTypeInfo> = {};
    for (const t of manifest?.types ?? []) m[t.key] = t;
    return m;
  }, [manifest?.types]);

  const activeFloor = manifest?.floors.find(f => f.id === activeFloorId) ?? null;
  const activeAnchors = useMemo(
    () => (manifest && activeFloorId != null ? manifest.anchors[activeFloorId] ?? [] : []),
    [manifest, activeFloorId],
  );

  /** Is the selected marker's icon currently pulled out of its spot? */
  const selectedPulledOut = useMemo(() => {
    if (!editSel) return false;
    const a = activeAnchors.find(x => x.id === editSel.anchorId);
    return !!a && a.pinCx != null && a.pinCy != null;
  }, [editSel, activeAnchors]);

  /**
   * Only a MARKER can be pulled out. A detected 'overlay' anchor is a shape
   * drawn on the plan with no icon to move, so it is never offered the action
   * — an button that always fails is worse than no button.
   */
  const selectedCanPullOut = useMemo(() => {
    if (!editSel) return false;
    return activeAnchors.find(x => x.id === editSel.anchorId)?.display === 'pin';
  }, [editSel, activeAnchors]);

  // Type chips: only types that actually appear on the active floor.
  const chipTypes = useMemo(() => {
    const present = new Set(activeAnchors.map(a => a.typeKey));
    return (manifest?.types ?? []).filter(t => present.has(t.key) && !t.hidden);
  }, [activeAnchors, manifest?.types]);

  /**
   * What the plan actually draws. The chips narrow THIS; everything else —
   * room inference when adding, the parent suggestions, the places directory —
   * keeps reading the full `activeAnchors`, so filtering only ever changes what
   * you look at, never what the app knows.
   */
  const visibleAnchors = useMemo(
    () => filterByType(activeAnchors, filterTypes),
    [activeAnchors, filterTypes],
  );

  const toggleFilterType = (key: string) =>
    setFilterTypes(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));

  // A type leaves the floor when its last marker is removed, and its chip goes
  // with it. Drop it from the filter too — otherwise the plan sits empty with
  // no chip left to switch back off.
  useEffect(() => {
    const keys = new Set(chipTypes.map(t => t.key));
    setFilterTypes(prev => {
      const next = prev.filter(k => keys.has(k));
      return next.length === prev.length ? prev : next;
    });
  }, [chipTypes]);

  // A marker that filtering just took off the plan must not keep the selection,
  // the edit bar or the sheet — they would all be pointing at nothing visible.
  useEffect(() => {
    if (!filterTypes.length) return;
    const shown = new Set(visibleAnchors.map(a => a.locationId));
    if (selectedId != null && !shown.has(selectedId)) setSelectedId(null);
    if (sheetId != null && !shown.has(sheetId)) setSheetId(null);
    if (editSel && !shown.has(editSel.locationId)) setEditSel(null);
  }, [filterTypes, visibleAnchors, selectedId, sheetId, editSel]);

  const switchFloor = (floorId: number) => {
    setActiveFloorId(floorId);
    setSelectedId(null);
    setSheetId(null);
    setFilterTypes([]);
    setEditSel(null);   // never keep a Remove-marker bar for an off-screen anchor
    setRemoveAsk(null); setRemoveErr(null);
    setArmed(null);
    setAddForm(null);
    if (manifest && typeof window !== 'undefined') {
      window.localStorage.setItem(`kw_fp_floor_${manifest.companyId}`, String(floorId));
    }
  };

  const focusLocation = useCallback((locationId: number) => {
    if (!manifest) return;
    // The anchor may live on another floor — switch first, then glide.
    let anchor = null as null | { floorId: number; cx: number; cy: number; typeKey: string };
    for (const [fidStr, list] of Object.entries(manifest.anchors)) {
      const hit = list.find(a => a.locationId === locationId);
      if (hit) { anchor = { floorId: Number(fidStr), cx: hit.cx, cy: hit.cy, typeKey: hit.typeKey }; break; }
    }
    if (!anchor) { setSheetId(locationId); return; } // not placed → sheet still informs
    if (anchor.floorId !== activeFloorId) switchFloor(anchor.floorId);
    // Searching for something the chips are hiding wins: flying to a marker
    // that is filtered off the plan would land on an empty spot. The search
    // asked for THIS place, so the filter steps aside.
    setFilterTypes(prev => (prev.length && !prev.includes(anchor!.typeKey) ? [] : prev));
    setSelectedId(locationId);
    setSheetId(locationId);
    setFlyTo({ cx: anchor.cx, cy: anchor.cy, seq: ++seqRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, activeFloorId]);

  const closeSheet = () => { setSheetId(null); setSelectedId(null); };
  const canManage = capabilities.includes('inventory.location.manage');

  const PREFIX: Record<string, string> = { shelf: 'SLF', floorspace: 'FLS', cabinet: 'CAB', fridge: 'REF', freezer: 'FRZ' };
  /**
   * Next free number for a type. Counts the whole LOCATION TREE, not just what
   * is on this plan: a spot taken off the map still exists and still owns its
   * name, so suggesting from markers alone proposed a name the server then
   * refused as a duplicate ("SLF 20 already exists" right after removing it).
   */
  const suggestCode = (typeKey: string): string => {
    const prefix = PREFIX[typeKey] ?? (typesByKey[typeKey]?.label ?? typeKey).toUpperCase();
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?(\\d+)$`, 'i');
    let max = 0;
    for (const name of [...activeAnchors.map(a => a.label), ...treeLocations.map(l => l.name)]) {
      const m = name.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix} ${max + 1}`;
  };

  const placeSpot = async () => {
    if (!addForm || activeFloorId == null) return;
    const body = addForm.existingId != null
      ? { floorId: activeFloorId, x: addForm.x, y: addForm.y, existingLocationId: addForm.existingId }
      : { floorId: activeFloorId, x: addForm.x, y: addForm.y, typeKey: armed, code: addForm.code, roomLocationId: addForm.roomId };
    if (addForm.existingId == null && !armed) return;
    const res = await fetch('/api/inventory/floorplan-anchors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) { toast(d.error ?? 'Could not add the spot'); return; }
    setAddForm(null);
    // Placing a fridge while the chips are showing only rooms would put it on
    // the plan and hide it in the same breath. Whatever you just placed, you
    // get to see: its type joins the filter.
    const placedType = addForm.existingId != null
      ? treeLocations.find(l => l.id === addForm.existingId)?.kind ?? null
      : armed;
    if (placedType) setFilterTypes(prev => (prev.length && !prev.includes(placedType) ? [...prev, placedType] : prev));
    // Keep the type ARMED: marking a blank plan means placing ten shelves in a
    // row — re-picking the chip every time would double the work. Tap ✓ Done
    // or the chip again to disarm.
    toast(addForm.existingId != null
      ? 'Placed — same location, now on the plan'
      : `${addForm.code} placed · tap again for the next ${typesByKey[armed ?? '']?.label.toLowerCase() ?? 'one'}`);
    load();
  };

  /** Patch one anchor in the loaded manifest (optimistic — the screen must
   *  never disagree with what the server accepted). */
  const patchAnchor = (anchorId: number, next: { polygon: Pt[]; cx: number; cy: number }) => {
    setResp(prev => {
      if (!prev?.manifest) return prev;
      const anchors: typeof prev.manifest.anchors = {};
      let changed = false;
      for (const [fid, list] of Object.entries(prev.manifest.anchors)) {
        anchors[Number(fid)] = list.map(a => {
          if (a.id !== anchorId) return a;
          changed = true;
          return { ...a, polygon: next.polygon, cx: next.cx, cy: next.cy };
        });
      }
      return changed ? { ...prev, manifest: { ...prev.manifest, anchors } } : prev;
    });
  };

  /** Same optimistic patch, but for where the ICON is drawn. */
  const patchPin = (anchorId: number, pinCx: number | null, pinCy: number | null) => {
    setResp(prev => {
      if (!prev?.manifest) return prev;
      const anchors: typeof prev.manifest.anchors = {};
      let changed = false;
      for (const [fid, list] of Object.entries(prev.manifest.anchors)) {
        anchors[Number(fid)] = list.map(a => {
          if (a.id !== anchorId) return a;
          changed = true;
          return { ...a, pinCx, pinCy };
        });
      }
      return changed ? { ...prev, manifest: { ...prev.manifest, anchors } } : prev;
    });
  };

  /**
   * Dragging an icon fires one PATCH per drop, so several can be in play for
   * the SAME anchor. Three separate things have to be true, and each needs its
   * own mechanism:
   *
   *  - seq  — only the NEWEST request may roll back or speak. An older failure
   *           must not drag the icon back from where the manager has since put it.
   *  - queue— one request per anchor AT A TIME. Ordering the responses is not
   *           enough: two in flight can REACH THE SERVER out of order and leave
   *           the database on the older position while the screen shows the newer.
   *  - saved— roll back to the last position the SERVER CONFIRMED, not to the
   *           previous optimistic value, which may itself never have persisted.
   *
   * All three are cleared once an anchor goes quiet, so the maps stay small.
   */
  const pinSeqRef = useRef<Map<number, number>>(new Map());
  const pinQueueRef = useRef<Map<number, Promise<unknown>>>(new Map());
  const pinSavedRef = useRef<Map<number, { pinCx: number | null; pinCy: number | null }>>(new Map());

  const savePin = async (
    anchor: { id: number; pinCx: number | null; pinCy: number | null },
    pinCx: number | null, pinCy: number | null, okMsg: string,
  ) => {
    const id = anchor.id;
    // First touch of a quiet anchor: its current value IS the persisted one.
    if (!pinSavedRef.current.has(id)) {
      pinSavedRef.current.set(id, { pinCx: anchor.pinCx, pinCy: anchor.pinCy });
    }
    const seq = (pinSeqRef.current.get(id) ?? 0) + 1;
    pinSeqRef.current.set(id, seq);
    const stillNewest = () => pinSeqRef.current.get(id) === seq;

    // Optimistic move happens NOW, not when the queue reaches this request —
    // the icon must follow the finger even while an earlier save is in flight.
    patchPin(id, pinCx, pinCy);

    const send = async () => {
      try {
        const res = await fetch(`/api/inventory/floorplan-anchors/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinCx, pinCy }),
        });
        if (res.ok) {
          pinSavedRef.current.set(id, { pinCx, pinCy });
          if (stillNewest()) toast(okMsg);
          return;
        }
        if (!stillNewest()) return;              // a newer drag owns the screen
        const saved = pinSavedRef.current.get(id)!;
        patchPin(id, saved.pinCx, saved.pinCy);
        toast('Could not save — put back where it was');
      } catch {
        // Offline, timeout, reset: fetch REJECTS rather than returning !ok, so
        // without this the optimistic move would stick on screen unsaved — and
        // could be written into the offline cache as though it were real.
        if (!stillNewest()) return;
        const saved = pinSavedRef.current.get(id)!;
        patchPin(id, saved.pinCx, saved.pinCy);
        toast('No connection — put back where it was');
      } finally {
        // Anchor is quiet again: drop its bookkeeping so a long session on a
        // big plan does not accumulate an entry per marker ever touched.
        if (stillNewest()) {
          pinQueueRef.current.delete(id);
          pinSavedRef.current.delete(id);
          pinSeqRef.current.delete(id);
        }
      }
    };

    const chained = (pinQueueRef.current.get(id) ?? Promise.resolve()).then(send, send);
    pinQueueRef.current.set(id, chained);
    await chained;
  };

  /**
   * Pull the icon out of a crowded room, or snap it back. The first pull-out
   * lands the icon up and to the right of its spot — far enough to clear the
   * room, close enough that the arrow is short and obviously connected. From
   * there it is dragged wherever there is space.
   */
  const togglePullOut = async () => {
    if (!editSel) return;
    const anchor = activeAnchors.find(a => a.id === editSel.anchorId);
    if (!anchor || anchor.display !== 'pin') return;   // shapes have no icon to pull out
    if (anchor.pinCx != null && anchor.pinCy != null) {
      await savePin(anchor, null, null, 'Icon back on its spot');
      return;
    }
    const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
    await savePin(anchor, clamp(anchor.cx + 0.09), clamp(anchor.cy - 0.07), 'Pulled out — drag it where there is space');
  };

  const moveAnchor = async (anchor: { id: number; polygon: Pt[]; cx: number; cy: number }, polygon: Pt[], cx: number, cy: number) => {
    const previous = { polygon: anchor.polygon, cx: anchor.cx, cy: anchor.cy };
    patchAnchor(anchor.id, { polygon, cx, cy });   // keep the screen truthful
    const res = await fetch(`/api/inventory/floorplan-anchors/${anchor.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon, cx, cy }),
    });
    if (!res.ok) {
      patchAnchor(anchor.id, previous);            // rejected → put it back
      toast('Could not save the new position — put back where it was');
    } else {
      toast('Position saved');
    }
  };

  const renameSelected = async () => {
    if (!editSel) return;
    const next = window.prompt('Name this place', editSel.label);
    if (next == null || !next.trim() || next.trim() === editSel.label) return;
    const res = await fetch('/api/inventory/count-locations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editSel.locationId, name: next.trim() }),
    });
    if (!res.ok) { toast((await res.json().catch(() => ({}))).error ?? 'Could not rename'); return; }
    setEditSel(sel => (sel ? { ...sel, label: next.trim() } : sel));
    toast('Renamed');
    load();
  };

  /** Take the marker off the plan; the spot stays in Locations. */
  const removeAnchor = async () => {
    if (!editSel) return;
    const res = await fetch(`/api/inventory/floorplan-anchors/${editSel.anchorId}`, { method: 'DELETE' });
    if (!res.ok) toast('Could not remove the marker');
    else toast(`${editSel.label} taken off the map — the spot itself is still in Locations`);
    setEditSel(null);
    setRemoveAsk(null);
    load();
  };

  /**
   * Delete the spot itself. The server refuses if anything is inside it, on it
   * or counted against it, and says which — so "delete" is either complete or
   * it explains itself. It is never a silent half-delete that leaves the name
   * taken (which is exactly the trap this replaces).
   */
  const deleteSpot = async () => {
    if (!removeAsk) return;
    setRemoveErr(null);
    const res = await fetch(`/api/inventory/floorplan/spots/${removeAsk.locationId}`, { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    // The refusal belongs IN the dialog: a toast behind this overlay is dimmed
    // by it, so the reason you cannot delete would be the one thing you cannot
    // read. The dialog stays open with "take it off the map" still offered.
    if (!res.ok) { setRemoveErr(d.error ?? 'Could not delete that spot'); return; }
    // Drop it from the tree right away: the reload below refreshes it anyway,
    // but the next code suggestion must not be able to read a spot that is
    // already gone (that is what made the name look permanently taken).
    // Bumping the token in the same breath retires any tree request already in
    // flight — one of those answering late would put the deleted spot back.
    treeTokenRef.current += 1;
    setTreeLocations(prev => prev.filter(l => l.id !== removeAsk.locationId));
    toast(`${removeAsk.label} deleted`);
    setRemoveAsk(null);
    setEditSel(null);
    setSelectedId(null);
    load();
  };

  useEffect(() => {
    if (!manifest) return;
    // Request token, for the reason in the header note: every placement and
    // every delete reloads the manifest, which re-fires this fetch. Two are
    // then in flight at once, and the OLDER one answering last used to win —
    // the tree would quietly go back to including a spot that had just been
    // deleted, and the next suggested code skipped a number to avoid a name
    // nothing was using any more.
    const token = ++treeTokenRef.current;
    fetch(`/api/inventory/count-locations?company_id=${manifest.companyId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (treeTokenRef.current === token && d?.locations) setTreeLocations(d.locations); })
      .catch(() => { /* link-existing just stays empty */ });
  }, [manifest]);

  const placedEverywhere = useMemo(() => {
    const ids = new Set<number>();
    for (const list of Object.values(manifest?.anchors ?? {})) for (const a of list) ids.add(a.locationId);
    return ids;
  }, [manifest?.anchors]);

  /** Existing tree locations not yet on any plan — candidates for linking. */
  const unplacedLocations = useMemo(() => {
    const byId = new Map(treeLocations.map(l => [l.id, l]));
    return treeLocations
      .filter(l => !placedEverywhere.has(l.id))
      .map(l => ({ id: l.id, label: l.parent_id && byId.get(l.parent_id) ? `${byId.get(l.parent_id)!.name} › ${l.name}` : l.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [treeLocations, placedEverywhere]);

  /** Which room is at this point? Containment on the room label's box, else nearest room anchor. */
  const inferRoom = useCallback((pt: Pt): number | null => {
    const ROOMISH = new Set(['room', 'area', 'floor']);
    const rooms = activeAnchors.filter(a => ROOMISH.has(a.typeKey));
    if (rooms.length === 0) return null;
    const hit = rooms.find(a => pointInPolygon(pt, a.polygon));
    if (hit) return hit.locationId;
    const W = activeFloor?.revision?.width ?? 1, H = activeFloor?.revision?.height ?? 1;
    let best: number | null = null, bd = Infinity;
    for (const a of rooms) {
      const d = Math.hypot((pt.x - a.cx) * W, (pt.y - a.cy) * H);
      if (d < bd) { bd = d; best = a.locationId; }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnchors, activeFloor?.revision]);

  /**
   * Which place should a new item of this type sit inside? The LAYER decides:
   * an item (layer 3) belongs in the room (layer 2) you dropped it in; a level
   * (layer 4) belongs in the nearest ITEM. That is the same sequence staff are
   * guided along — area → room → item → inside.
   */
  const inferParent = useCallback((typeKey: string, pt: Pt): number | null => {
    const layer = typesByKey[typeKey]?.layer ?? 3;
    if (layer <= 2) return null;                    // areas/rooms stand alone
    const wantLayer = layer - 1;                    // sit inside the layer above
    const W = activeFloor?.revision?.width ?? 1, H = activeFloor?.revision?.height ?? 1;
    const canParent = (a: { typeKey: string }) => !typesByKey[a.typeKey]?.markerOnly;
    const candidates = activeAnchors.filter(a => canParent(a) && (typesByKey[a.typeKey]?.layer ?? 3) === wantLayer);
    const pool = candidates.length > 0
      ? candidates
      : activeAnchors.filter(a => canParent(a) && (typesByKey[a.typeKey]?.layer ?? 3) < layer);
    if (pool.length === 0) return null;
    const inside = pool.find(a => pointInPolygon(pt, a.polygon));
    if (inside) return inside.locationId;
    let best: number | null = null, bd = Infinity;
    for (const a of pool) {
      const d = Math.hypot((pt.x - a.cx) * W, (pt.y - a.cy) * H);
      if (d < bd) { bd = d; best = a.locationId; }
    }
    return best;
  }, [activeAnchors, activeFloor?.revision, typesByKey]);

  const openAddForm = useCallback((typeKey: string, pt: Pt) => {
    setArmed(typeKey);
    setAddForm({ x: pt.x, y: pt.y, code: suggestCode(typeKey), roomId: inferParent(typeKey, pt), existingId: null });
    // treeLocations belongs here: suggestCode reads it, and the tree arrives
    // asynchronously. Without it this callback keeps whichever tree was loaded
    // when it was last rebuilt — an empty one on first paint, or one still
    // holding a spot that has since been deleted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferParent, activeAnchors, treeLocations]);

  const roomOptions = useMemo(
    () => (manifest ? manifest.places.filter(p => p.bucket === 'room' && p.floorId === activeFloorId) : []),
    [manifest, activeFloorId],
  );

  /**
   * Every place this new item could sit INSIDE — the whole tree, not just
   * rooms: a countertop fridge holds drawers D1..D8, and those drawers belong
   * under the fridge, not under the kitchen.
   */
  const parentOptions = useMemo(() => {
    const byId = new Map(treeLocations.map(l => [l.id, l]));
    const pathOf = (l: { id: number; name: string; parent_id: number | null }): string => {
      const parts: string[] = [l.name];
      let cur = l.parent_id != null ? byId.get(l.parent_id) : undefined;
      const seen = new Set<number>([l.id]);
      while (cur && !seen.has(cur.id)) { parts.unshift(cur.name); seen.add(cur.id); cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined; }
      return parts.join(' › ');
    };
    // A marker type (shut-off valve, fuse box) marks a thing, so nothing sits
    // inside it — it is never offered as a parent.
    return treeLocations
      .filter(l => !typesByKey[l.kind]?.markerOnly)
      .map(l => ({ id: l.id, label: pathOf(l) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [treeLocations, typesByKey]);

  const header = (
    <AppHeader
      supertitle="INVENTORY"
      title="Floorplan"
      showBack={!onClose}
      onBack={() => router.push('/inventory')}
      action={onClose ? undefined : <CompanyPill onSwitched={load} />}
    />
  );

  if (state === 'loading') {
    return (
      <div className={stateClass}>
        {header}
        <div className="flex flex-1 items-center justify-center text-[13px] text-gray-500">Loading the floorplan…</div>
      </div>
    );
  }
  if (state === 'error' || !manifest) {
    return (
      <div className={stateClass}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="text-3xl">🗺️</div>
          <p className="text-[14px] font-semibold text-gray-800">The floorplan could not be loaded</p>
          <p className="text-[12.5px] text-gray-500">Check your connection, then try again.</p>
          <button onClick={load} className="mt-1 h-11 rounded-full bg-green-600 px-6 text-[14px] font-bold text-white active:scale-[0.98]">Try again</button>
        </div>
      </div>
    );
  }

  const floorsWithPlans = manifest.floors.filter(f => f.revision);
  if (floorsWithPlans.length === 0 || !activeFloor?.revision) {
    return (
      <div className={stateClass}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="text-3xl">🗺️</div>
          <p className="text-[14px] font-semibold text-gray-800">No floor plan here yet</p>
          {canManage ? (
            <>
              <p className="text-[12.5px] text-gray-500">
                Upload the Illustrator PDF for this restaurant — labels are detected automatically.
              </p>
              <button
                onClick={() => router.push('/inventory/floorplan/manage')}
                className="mt-1 h-11 rounded-full bg-green-600 px-6 text-[14px] font-bold text-white active:scale-[0.98]"
              >
                🛠 Manage floor plans
              </button>
            </>
          ) : (
            <p className="text-[12.5px] text-gray-500">
              Ask a manager to upload the plan — it takes about a minute.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {/* Immersive editing: the page header and the search bar are navigation,
          and navigation is not what you are doing while placing markers. */}
      {!immersive && header}
      {offlineFrom && (
        <div className="bg-amber-500 px-3 py-1.5 text-center text-[11.5px] font-bold text-white">
          Offline — showing the plan saved {new Date(offlineFrom).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {resp?.focusMissing && (
        <div className="mx-3 mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] font-medium text-amber-800">
          Not marked on the plan itself — it usually sits inside something that is. Details below.
        </div>
      )}
      {!immersive && <FloorplanSearch manifest={manifest} activeFloorId={activeFloorId} onPick={focusLocation} />}
      <div className={`flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] ${immersive ? 'py-1.5' : 'py-2'}`}>
        <button
          onClick={() => setFilterTypes([])}
          aria-pressed={filterTypes.length === 0}
          className={`h-[34px] flex-shrink-0 rounded-full border px-3.5 text-[12px] font-semibold ${filterTypes.length === 0 ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-900'}`}
        >
          All
        </button>
        {chipTypes.map(t => {
          const on = filterTypes.includes(t.key);
          return (
            <button
              key={t.key}
              onClick={() => toggleFilterType(t.key)}
              aria-pressed={on}
              className={`flex h-[34px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold ${on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-900'}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: on ? '#FFFFFF' : t.color }} />
              {t.label}
              {/* Several chips can be on at once, so each one has to say how to
                  get back out of it: tap again and this type drops off again. */}
              {on && <span aria-hidden className="text-[11px]">✕</span>}
            </button>
          );
        })}
        {canManage && !onClose && (
          <>
            {/* Immersive mode removes back and home, so the way OUT must never
                be scrolled off: pin it to the front of the row and keep it
                stuck there while the type chips scroll under it. */}
            <button
              onClick={() => { setEdit(e => !e); setArmed(null); setEditSel(null); setRemoveAsk(null); setRemoveErr(null); closeSheet(); }}
              className={`h-[34px] flex-shrink-0 rounded-full border px-3.5 text-[12px] font-bold ${edit ? 'border-green-600 bg-green-600 text-white' : 'border-blue-600 bg-white text-blue-600'} ${immersive ? 'sticky left-0 z-10 order-first shadow-[0_0_0_4px_rgba(249,250,251,1)]' : ''}`}
            >
              {edit ? '✓ Done' : '✏️ Edit'}
            </button>
            <button
              onClick={() => router.push('/inventory/floorplan/manage')}
              className="h-[34px] flex-shrink-0 rounded-full border border-gray-200 bg-white px-3.5 text-[12px] font-bold text-gray-700"
            >
              🛠 Plans
            </button>
          </>
        )}
      </div>
      {edit && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-y border-gray-200 bg-gray-900 px-3 py-2 [scrollbar-width:none]">
          <span className="flex-shrink-0 text-[10px] font-extrabold tracking-[0.08em] text-gray-400">ADD:</span>
          {(manifest?.types ?? []).filter(t => !t.hidden && !['floor'].includes(t.key)).map(t => (
            <button
              key={t.key}
              draggable
              onDragStart={e => { e.dataTransfer.setData('application/x-kw-loctype', t.key); e.dataTransfer.effectAllowed = 'copy'; setArmed(t.key); }}
              onClick={() => setArmed(armed === t.key ? null : t.key)}
              className={`flex h-9 flex-shrink-0 cursor-grab items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${armed === t.key ? 'border-white bg-white text-gray-900' : 'border-gray-600 bg-transparent text-gray-100'}`}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      )}
      {/* The standing hint is worth a row the first time and costs one every
          time after. It can be dismissed; the ARMED hint always shows, because
          then it is telling you what your next tap will do. */}
      {edit && (armed || showEditHint) && (
        <div className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 text-[11.5px] font-medium text-gray-200">
          <span className="min-w-0 flex-1">
            {armed
              ? `Tap or drop where the ${typesByKey[armed]?.label.toLowerCase() ?? 'item'} is — name it, press Enter, place the next one.`
              : 'Zoom in, then DRAG any marker to place it exactly · tap one to rename or remove · pick a type above to add.'}
          </span>
          {armed ? (
            <button
              onClick={() => setArmed(null)}
              className="flex-shrink-0 rounded-full border border-gray-500 px-2.5 py-0.5 text-[11px] font-bold text-gray-100"
            >
              Stop adding
            </button>
          ) : (
            <button
              onClick={() => setShowEditHint(false)}
              aria-label="Hide this hint"
              className="flex-shrink-0 rounded-full border border-gray-500 px-2.5 py-0.5 text-[11px] font-bold text-gray-100"
            >
              Got it
            </button>
          )}
        </div>
      )}
      {editSel && (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-[12.5px] font-semibold text-amber-900">
            {selectedPulledOut
              ? `${editSel.label} — drag the icon to move it, drag the ring to move the spot`
              : `${editSel.label} — drag it on the plan to reposition`}
          </span>
          {selectedCanPullOut && (
            <button
              onClick={togglePullOut}
              title={selectedPulledOut
                ? 'Put the icon back on its spot'
                : 'Move the icon out of a crowded room; an arrow keeps pointing at the spot'}
              className="h-9 flex-shrink-0 rounded-full border-[1.5px] border-amber-600 bg-white px-3.5 text-[12px] font-bold text-amber-700"
            >
              {selectedPulledOut ? '↙ Snap back' : '↗ Pull out'}
            </button>
          )}
          <button onClick={renameSelected} className="h-9 flex-shrink-0 rounded-full border-[1.5px] border-blue-600 bg-white px-3.5 text-[12px] font-bold text-blue-700">Rename</button>
          <button onClick={() => { setRemoveErr(null); setRemoveAsk(editSel); }} className="h-9 flex-shrink-0 rounded-full bg-red-600 px-3.5 text-[12px] font-bold text-white">Remove</button>
          <button onClick={() => { setEditSel(null); setSelectedId(null); }} className="h-9 flex-shrink-0 rounded-full border border-gray-300 bg-white px-3.5 text-[12px] font-bold text-gray-700">Done</button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <FloorplanMap
          revision={offlineFrom && activeFloor.revision && offlineRasters[activeFloor.revision.id]
            ? { ...activeFloor.revision, rasterUrl: offlineRasters[activeFloor.revision.id] }
            : activeFloor.revision}
          anchors={visibleAnchors}
          typesByKey={typesByKey}
          selectedId={selectedId}
          filtered={filterTypes.length > 0}
          editable={edit}
          onTapAnchor={id => {
            if (edit) {
              // Tapping an existing marker always selects it — even with a type
              // armed — so you can move or remove it without disarming first.
              const a = activeAnchors.find(x => x.locationId === id);
              if (a) { setEditSel({ anchorId: a.id, locationId: id, label: a.label }); setSelectedId(id); }
              return;
            }
            setSelectedId(id); setSheetId(id);
          }}
          onTapEmpty={pt => {
            if (edit && armed) { openAddForm(armed, pt); return; }
            if (!edit) closeSheet();
            setEditSel(null);
            if (edit) setSelectedId(null);
          }}
          onMoveAnchor={(a, polygon, cx, cy) => moveAnchor(a, polygon, cx, cy)}
          onMovePin={(a, pinCx, pinCy) => savePin(a, pinCx, pinCy, 'Icon moved')}
          onDropType={(typeKey, pt) => { if (edit) openAddForm(typeKey, pt); }}
          flyTo={flyTo}
        />
        {notice && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-[30] -translate-x-1/2 rounded-full bg-gray-900/90 px-4 py-2 text-[12px] font-semibold text-white">
            {notice}
          </div>
        )}
        {/* Floors, by NAME. This used to squeeze each one into a 48px square as
            `code || name.slice(0, 3)`, which for "Ssam Ground Floor" and "Ssam
            Basement" printed "Ssa" twice — two identical buttons that told you
            nothing (Ethan, 2026-08-01). Names are what people call floors, so
            names are what the buttons say; they only truncate when a name is
            wider than half the screen. */}
        {floorsWithPlans.length > 1 && (
          <div className="absolute bottom-4 right-3 z-[20] flex flex-col items-end gap-1.5">
            {floorsWithPlans.map(f => (
              <button
                key={f.id}
                onClick={() => switchFloor(f.id)}
                title={f.name}
                aria-current={f.id === activeFloorId ? 'true' : undefined}
                className={`h-11 max-w-[55vw] truncate rounded-xl border px-3.5 text-[13px] font-bold shadow-sm ${f.id === activeFloorId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close the floorplan"
            className="absolute right-3 top-3 z-[20] h-10 w-10 rounded-full bg-gray-900/80 text-[15px] text-white"
          >
            ✕
          </button>
        )}
      </div>
      {sheetId != null && !edit && (
        <FloorplanSpotSheet
          locationId={sheetId}
          typesByKey={typesByKey}
          canEditProductPhotos={capabilities.includes('inventory.productsettings.manage')}
          canEditSpotPhoto={canManage}
          canAssignProducts={canManage || capabilities.includes('inventory.productsettings.manage') || capabilities.includes('inventory.template.manage')}
          onOpenLocation={id => { setSheetId(id); const a = activeAnchors.find(x => x.locationId === id); if (a) { setSelectedId(id); setFlyTo({ cx: a.cx, cy: a.cy, seq: ++seqRef.current }); } }}
          onClose={closeSheet}
        />
      )}
      {addForm && armed && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/40 p-6" onClick={() => setAddForm(null)}>
          <div
            className="max-h-[90vh] w-full max-w-xs overflow-y-auto rounded-2xl bg-white p-4"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void placeSpot(); }
              if (e.key === 'Escape') setAddForm(null);
            }}
          >
            <h4 className="mb-3 text-[15px] font-bold text-gray-900">
              {typesByKey[armed]?.icon} Add {typesByKey[armed]?.label.toLowerCase()} here
            </h4>
            {addForm.existingId == null && (
              <>
                <input
                  value={addForm.code}
                  onChange={e => setAddForm(f => (f ? { ...f, code: e.target.value } : f))}
                  aria-label="Name"
                  autoFocus
                  onFocus={e => e.target.select()}
                  className="mb-2 h-11 w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] font-semibold outline-none focus:border-blue-600"
                />
                <select
                  value={addForm.roomId ?? ''}
                  onChange={e => setAddForm(f => (f ? { ...f, roomId: e.target.value ? Number(e.target.value) : null } : f))}
                  aria-label="Inside"
                  className="mb-1 h-11 w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 outline-none"
                >
                  <option value="">· not inside anything ·</option>
                  {(parentOptions.length > 0 ? parentOptions : roomOptions.map(r => ({ id: r.locationId, label: r.label })))
                    .map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <p className="mb-2 text-[11px] text-gray-400">
                  Pick a room — or a fridge/shelf to nest this inside it (e.g. drawer D1 inside a countertop fridge).
                </p>
              </>
            )}
            {unplacedLocations.length > 0 && (
              <select
                value={addForm.existingId ?? ''}
                onChange={e => setAddForm(f => (f ? { ...f, existingId: e.target.value ? Number(e.target.value) : null } : f))}
                aria-label="Link an existing location"
                className="mb-3 h-11 w-full rounded-xl border-[1.5px] border-dashed border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-700 outline-none"
              >
                <option value="">· create as NEW — or pick an existing location ·</option>
                {unplacedLocations.map(l => <option key={l.id} value={l.id}>📍 {l.label}</option>)}
              </select>
            )}
            {addForm.existingId != null && (
              <p className="mb-3 text-[12px] leading-relaxed text-gray-500">
                Places the existing location here — its name, type and product links stay exactly as they are.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setAddForm(null)} className="h-11 flex-1 rounded-full border-[1.5px] border-gray-200 text-[13.5px] font-bold text-gray-700">Cancel</button>
              <button onClick={placeSpot} className="h-11 flex-1 rounded-full bg-green-600 text-[13.5px] font-bold text-white">Add spot</button>
            </div>
          </div>
        </div>
      )}
      {/* Removing has two different meanings and used to have one button. */}
      {removeAsk && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/40 p-6" onClick={() => setRemoveAsk(null)}>
          <div className="max-h-[90vh] w-full max-w-xs overflow-y-auto rounded-2xl bg-white p-4" onClick={e => e.stopPropagation()}>
            <h4 className="mb-1 text-[15px] font-bold text-gray-900">Remove {removeAsk.label}?</h4>
            <p className="mb-3 text-[12px] leading-relaxed text-gray-500">
              Delete it and the spot is gone for good — its name is free again. Take it off the map
              and the spot stays in Locations, ready to place somewhere else.
            </p>
            {removeErr && (
              <p className="mb-3 rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] font-medium leading-relaxed text-red-700">
                {removeErr}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={deleteSpot} className="h-11 w-full rounded-full bg-red-600 text-[13.5px] font-bold text-white">
                Delete the spot
              </button>
              <button onClick={removeAnchor} className="h-11 w-full rounded-full border-[1.5px] border-gray-200 text-[13.5px] font-bold text-gray-700">
                Only take it off the map
              </button>
              <button onClick={() => setRemoveAsk(null)} className="h-9 w-full text-[13px] font-semibold text-gray-500">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
