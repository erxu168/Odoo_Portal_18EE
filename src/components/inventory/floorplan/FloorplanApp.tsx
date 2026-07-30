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
import FloorplanMap, { type FlyTarget } from './FloorplanMap';
import FloorplanSearch from './FloorplanSearch';
import FloorplanSpotSheet from './FloorplanSpotSheet';

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
  const rootClass = onClose ? 'flex h-full flex-col overflow-hidden bg-gray-50' : 'flex h-[calc(100dvh-7.25rem)] flex-col overflow-hidden bg-gray-50';
  const stateClass = onClose ? 'flex h-full flex-col bg-gray-50' : 'flex min-h-screen flex-col bg-gray-50';
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [resp, setResp] = useState<ManifestResponse | null>(null);
  const [activeFloorId, setActiveFloorId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>(() => allowedActionKeysForRole('staff', {}));
  const [edit, setEdit] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<{ x: number; y: number; code: string; roomId: number | null } | null>(null);
  const [editSel, setEditSel] = useState<{ anchorId: number; locationId: number; label: string } | null>(null);
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
    setState('loading');
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
            setSelectedId(null); setSheetId(null); setFilterType(null);
            setEdit(false); setEditSel(null); setArmed(null); setAddForm(null);
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

  // Type chips: only types that actually appear on the active floor.
  const chipTypes = useMemo(() => {
    const present = new Set(activeAnchors.map(a => a.typeKey));
    return (manifest?.types ?? []).filter(t => present.has(t.key));
  }, [activeAnchors, manifest?.types]);

  const switchFloor = (floorId: number) => {
    setActiveFloorId(floorId);
    setSelectedId(null);
    setSheetId(null);
    setFilterType(null);
    setEditSel(null);   // never keep a Remove-marker bar for an off-screen anchor
    setArmed(null);
    setAddForm(null);
    if (manifest && typeof window !== 'undefined') {
      window.localStorage.setItem(`kw_fp_floor_${manifest.companyId}`, String(floorId));
    }
  };

  const focusLocation = useCallback((locationId: number) => {
    if (!manifest) return;
    // The anchor may live on another floor — switch first, then glide.
    let anchor = null as null | { floorId: number; cx: number; cy: number };
    for (const [fidStr, list] of Object.entries(manifest.anchors)) {
      const hit = list.find(a => a.locationId === locationId);
      if (hit) { anchor = { floorId: Number(fidStr), cx: hit.cx, cy: hit.cy }; break; }
    }
    if (!anchor) { setSheetId(locationId); return; } // not placed → sheet still informs
    if (anchor.floorId !== activeFloorId) switchFloor(anchor.floorId);
    setSelectedId(locationId);
    setSheetId(locationId);
    setFlyTo({ cx: anchor.cx, cy: anchor.cy, seq: ++seqRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, activeFloorId]);

  const closeSheet = () => { setSheetId(null); setSelectedId(null); };
  const canManage = capabilities.includes('inventory.location.manage');

  const PREFIX: Record<string, string> = { shelf: 'SLF', floorspace: 'FLS', cabinet: 'CAB', fridge: 'REF', freezer: 'FRZ' };
  const suggestCode = (typeKey: string): string => {
    const prefix = PREFIX[typeKey] ?? (typesByKey[typeKey]?.label ?? typeKey).toUpperCase();
    let max = 0;
    for (const a of activeAnchors) {
      const m = a.label.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?(\\d+)$`, 'i'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix} ${max + 1}`;
  };

  const placeSpot = async () => {
    if (!addForm || !armed || activeFloorId == null) return;
    const res = await fetch('/api/inventory/floorplan-anchors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        floorId: activeFloorId, x: addForm.x, y: addForm.y,
        typeKey: armed, code: addForm.code, roomLocationId: addForm.roomId,
      }),
    });
    const d = await res.json();
    if (!res.ok) { toast(d.error ?? 'Could not add the spot'); return; }
    setAddForm(null);
    setArmed(null);
    toast(`${addForm.code} placed — drag its handle to fine-tune`);
    load();
  };

  const moveAnchor = async (anchor: { id: number }, polygon: { x: number; y: number }[], cx: number, cy: number) => {
    const res = await fetch(`/api/inventory/floorplan-anchors/${anchor.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polygon, cx, cy }),
    });
    if (!res.ok) toast('Could not save the new position — it will snap back on reload');
    else toast('Position saved');
  };

  const removeAnchor = async () => {
    if (!editSel) return;
    const res = await fetch(`/api/inventory/floorplan-anchors/${editSel.anchorId}`, { method: 'DELETE' });
    if (!res.ok) toast('Could not remove the marker');
    else toast(`${editSel.label} removed from the map — the spot itself still exists`);
    setEditSel(null);
    load();
  };

  const roomOptions = useMemo(
    () => (manifest ? manifest.places.filter(p => p.bucket === 'room' && p.floorId === activeFloorId) : []),
    [manifest, activeFloorId],
  );

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
      {header}
      {offlineFrom && (
        <div className="bg-amber-500 px-3 py-1.5 text-center text-[11.5px] font-bold text-white">
          Offline — showing the plan saved {new Date(offlineFrom).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {resp?.focusMissing && (
        <div className="mx-3 mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] font-medium text-amber-800">
          This spot isn’t placed on a floor plan yet — a manager can add it in edit mode.
        </div>
      )}
      <FloorplanSearch manifest={manifest} activeFloorId={activeFloorId} onPick={focusLocation} />
      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        <button
          onClick={() => setFilterType(null)}
          className={`h-[34px] flex-shrink-0 rounded-full border px-3.5 text-[12px] font-semibold ${filterType === null ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-900'}`}
        >
          All
        </button>
        {chipTypes.map(t => (
          <button
            key={t.key}
            onClick={() => setFilterType(filterType === t.key ? null : t.key)}
            className={`flex h-[34px] flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold ${filterType === t.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-900'}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
            {t.label}
          </button>
        ))}
        {canManage && !onClose && (
          <>
            <button
              onClick={() => { setEdit(e => !e); setArmed(null); setEditSel(null); closeSheet(); }}
              className={`h-[34px] flex-shrink-0 rounded-full border px-3.5 text-[12px] font-bold ${edit ? 'border-green-600 bg-green-600 text-white' : 'border-blue-600 bg-white text-blue-600'}`}
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
          {(manifest?.types ?? []).filter(t => !['floor', 'area'].includes(t.key)).map(t => (
            <button
              key={t.key}
              onClick={() => setArmed(armed === t.key ? null : t.key)}
              className={`flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${armed === t.key ? 'border-white bg-white text-gray-900' : 'border-gray-600 bg-transparent text-gray-100'}`}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      )}
      {edit && (
        <div className="bg-gray-800 px-3 py-1.5 text-[11.5px] font-medium text-gray-200">
          {armed
            ? `Tap the plan where the ${typesByKey[armed]?.label.toLowerCase() ?? 'spot'} is.`
            : 'Drag a round handle to move a marker · tap a marker to remove it · pick a type above to add one.'}
        </div>
      )}
      {editSel && (
        <div className="flex items-center gap-2 bg-red-50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-red-900">{editSel.label}</span>
          <button onClick={removeAnchor} className="h-9 flex-shrink-0 rounded-full bg-red-600 px-3.5 text-[12px] font-bold text-white">Remove marker</button>
          <button onClick={() => setEditSel(null)} className="h-9 flex-shrink-0 rounded-full border border-gray-300 bg-white px-3.5 text-[12px] font-bold text-gray-700">Cancel</button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <FloorplanMap
          revision={offlineFrom && activeFloor.revision && offlineRasters[activeFloor.revision.id]
            ? { ...activeFloor.revision, rasterUrl: offlineRasters[activeFloor.revision.id] }
            : activeFloor.revision}
          anchors={activeAnchors}
          typesByKey={typesByKey}
          selectedId={selectedId}
          filterType={filterType}
          editable={edit}
          onTapAnchor={id => {
            if (edit) {
              const a = activeAnchors.find(x => x.locationId === id);
              if (a) setEditSel({ anchorId: a.id, locationId: id, label: a.label });
              return;
            }
            setSelectedId(id); setSheetId(id);
          }}
          onTapEmpty={pt => {
            if (edit && armed) { setAddForm({ x: pt.x, y: pt.y, code: suggestCode(armed), roomId: roomOptions[0]?.locationId ?? null }); return; }
            if (!edit) closeSheet();
            setEditSel(null);
          }}
          onMoveAnchor={(a, polygon, cx, cy) => moveAnchor(a, polygon, cx, cy)}
          flyTo={flyTo}
        />
        {notice && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-[30] -translate-x-1/2 rounded-full bg-gray-900/90 px-4 py-2 text-[12px] font-semibold text-white">
            {notice}
          </div>
        )}
        {floorsWithPlans.length > 1 && (
          <div className="absolute bottom-4 right-3 z-[20] flex flex-col gap-1.5">
            {floorsWithPlans.map(f => (
              <button
                key={f.id}
                onClick={() => switchFloor(f.id)}
                className={`h-11 w-12 rounded-xl border text-[13px] font-bold shadow-sm ${f.id === activeFloorId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600'}`}
              >
                {f.code || f.name.slice(0, 3)}
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
          onClose={closeSheet}
        />
      )}
      {addForm && armed && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-900/40 p-6" onClick={() => setAddForm(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4" onClick={e => e.stopPropagation()}>
            <h4 className="mb-3 text-[15px] font-bold text-gray-900">
              {typesByKey[armed]?.icon} Add {typesByKey[armed]?.label.toLowerCase()} here
            </h4>
            <input
              value={addForm.code}
              onChange={e => setAddForm(f => (f ? { ...f, code: e.target.value } : f))}
              aria-label="Spot code"
              className="mb-2 h-11 w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] font-semibold outline-none focus:border-blue-600"
            />
            <select
              value={addForm.roomId ?? ''}
              onChange={e => setAddForm(f => (f ? { ...f, roomId: e.target.value ? Number(e.target.value) : null } : f))}
              aria-label="Room"
              className="mb-3 h-11 w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 outline-none"
            >
              <option value="">· no room ·</option>
              {roomOptions.map(r => <option key={r.locationId} value={r.locationId}>{r.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setAddForm(null)} className="h-11 flex-1 rounded-full border-[1.5px] border-gray-200 text-[13.5px] font-bold text-gray-700">Cancel</button>
              <button onClick={placeSpot} className="h-11 flex-1 rounded-full bg-green-600 text-[13.5px] font-bold text-white">Add spot</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
