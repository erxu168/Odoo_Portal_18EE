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
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [resp, setResp] = useState<ManifestResponse | null>(null);
  const [activeFloorId, setActiveFloorId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [capabilities, setCapabilities] = useState<string[]>(() => allowedActionKeysForRole('staff', {}));
  const tokenRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (Array.isArray(d.user?.capabilities)) setCapabilities(d.user.capabilities);
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
        setResp(data);
        setState('ready');
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
      .catch(() => { if (tokenRef.current === token) setState('error'); });
  }, [focusLocationId]);

  useEffect(() => { load(); }, [load]);

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
      <div className="flex min-h-screen flex-col bg-gray-50">
        {header}
        <div className="flex flex-1 items-center justify-center text-[13px] text-gray-500">Loading the floorplan…</div>
      </div>
    );
  }
  if (state === 'error' || !manifest) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
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
      <div className="flex min-h-screen flex-col bg-gray-50">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="text-3xl">🗺️</div>
          <p className="text-[14px] font-semibold text-gray-800">No floor plan here yet</p>
          <p className="text-[12.5px] text-gray-500">
            A manager can upload the plan PDF under Inventory → Locations → Floorplans — labels are detected automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gray-50">
      {header}
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
      </div>
      <div className="relative min-h-0 flex-1">
        <FloorplanMap
          revision={activeFloor.revision}
          anchors={activeAnchors}
          typesByKey={typesByKey}
          selectedId={selectedId}
          filterType={filterType}
          editable={false}
          onTapAnchor={id => { setSelectedId(id); setSheetId(id); }}
          onTapEmpty={() => closeSheet()}
          flyTo={flyTo}
        />
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
      {sheetId != null && (
        <FloorplanSpotSheet
          locationId={sheetId}
          typesByKey={typesByKey}
          canEditProductPhotos={capabilities.includes('inventory.productsettings.manage')}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
