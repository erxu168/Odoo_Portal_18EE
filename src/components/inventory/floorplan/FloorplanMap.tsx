'use client';
/**
 * The Leaflet viewport: one floor's raster as a CRS.Simple image-map with
 * anchors on top. Detected drawn labels are INVISIBLE tap polygons that only
 * show a colored outline when selected or type-filtered (the drawn plan stays
 * the visual); app-added spots render as white icon pills (divIcon markers,
 * constant screen size). Edit mode adds a drag handle per anchor and reports
 * tap-on-empty for placing new spots.
 *
 * All Leaflet work happens imperatively inside effects — Leaflet 1.9 has no
 * React wrapper compatible with React 18 worth its dependency cost.
 */
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import './floorplan.css';
import type * as Leaflet from 'leaflet';
import type { ManifestAnchor, FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';
import type { Pt } from '@/lib/inventory-floorplan/types';

export interface FlyTarget { cx: number; cy: number; seq: number }

interface Props {
  /** Bump seq to glide the view so (cx,cy) lands ~38% from the top, clear of the sheet. */
  flyTo?: FlyTarget | null;
  /** Desktop drag & drop: a type chip dropped onto the plan. */
  onDropType?: (typeKey: string, pt: Pt) => void;
  revision: { rasterUrl: string; width: number; height: number };
  anchors: ManifestAnchor[];
  typesByKey: Record<string, FloorplanTypeInfo>;
  selectedId: number | null;
  filterType: string | null;
  editable: boolean;
  onTapAnchor: (locationId: number) => void;
  onTapEmpty?: (pt: Pt) => void;
  onMoveAnchor?: (anchor: ManifestAnchor, polygon: Pt[], cx: number, cy: number) => void;
}

interface AnchorLayers {
  anchor: ManifestAnchor;
  poly?: Leaflet.Polygon;
  pin?: Leaflet.Marker;
  handle?: Leaflet.Marker;
}

interface World {
  L: typeof Leaflet;
  map: Leaflet.Map;
  layers: Map<number, AnchorLayers>; // keyed by anchor id
  width: number;
  height: number;
}

export default function FloorplanMap({
  revision, anchors, typesByKey, selectedId, filterType, editable,
  onTapAnchor, onTapEmpty, onMoveAnchor, flyTo, onDropType,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // Callbacks kept current without re-initializing the map.
  const cbRef = useRef({ onTapAnchor, onTapEmpty, onMoveAnchor, onDropType, editable });
  cbRef.current = { onTapAnchor, onTapEmpty, onMoveAnchor, onDropType, editable };

  const fracToLatLng = (w: World, p: Pt): Leaflet.LatLngExpression => [w.height * (1 - p.y), w.width * p.x];
  const latLngToFrac = (w: World, ll: Leaflet.LatLng): Pt => ({ x: ll.lng / w.width, y: 1 - ll.lat / w.height });

  // ---- map lifecycle (per revision) ----------------------------------------
  useEffect(() => {
    let cancelled = false;
    let world: World | null = null;
    (async () => {
      const mod = await import('leaflet');
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        crs: L.CRS.Simple,
        zoomSnap: 0,
        zoomControl: false,
        attributionControl: false,
        inertia: true,
      });
      const bounds = L.latLngBounds([[0, 0], [revision.height, revision.width]]);
      L.imageOverlay(revision.rasterUrl, bounds).addTo(map);
      // CRS.Simple renders at scale 2^zoom, so the zoom where the WHOLE plan
      // fits is plain math. Leaflet's getBoundsZoom proved unreliable during
      // late flex layout (it locked users zoomed-in on desktop) — never ask it.
      const applyZoomLimits = () => {
        const size = map.getSize();
        if (size.x < 50 || size.y < 50) return; // not laid out yet — resize will call again
        const fitZoom = Math.log2(Math.min(size.x / revision.width, size.y / revision.height));
        map.setMinZoom(fitZoom - 0.2);
        map.setMaxZoom(fitZoom + 3.4);
        return fitZoom;
      };
      applyZoomLimits();
      map.fitBounds(bounds);
      map.setMaxBounds(bounds.pad(0.35));
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        const w = worldRef.current;
        if (w && cbRef.current.onTapEmpty) cbRef.current.onTapEmpty(latLngToFrac(w, e.latlng));
      });

      world = { L, map, layers: new Map(), width: revision.width, height: revision.height };
      worldRef.current = world;
      // test hook: lets browser tests read zoom/bounds state (no UI impact)
      (containerRef.current as unknown as { _kwMap?: Leaflet.Map })._kwMap = map;
      buildLayers(world);
      styleLayers(world);
      // A fly target that arrived BEFORE the map existed (QR deep link on a
      // cold load) must still run — the seq-effect fired into the void.
      if (flyRef.current) applyFly(world, flyRef.current);

      // Desktop drag & drop from the ADD tray: chips carry a custom MIME so
      // random file drags never trigger placement here.
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types.includes('application/x-kw-loctype')) e.preventDefault();
      };
      const onDrop = (e: DragEvent) => {
        const typeKey = e.dataTransfer?.getData('application/x-kw-loctype');
        if (!typeKey) return;
        e.preventDefault();
        const wNow = worldRef.current;
        if (!wNow || !cbRef.current.onDropType) return;
        const ll = map.mouseEventToLatLng(e as unknown as MouseEvent);
        cbRef.current.onDropType(typeKey, latLngToFrac(wNow, ll));
      };
      containerRef.current?.addEventListener('dragover', onDragOver);
      containerRef.current?.addEventListener('drop', onDrop);
      dragCleanupRef.current = () => {
        containerRef.current?.removeEventListener('dragover', onDragOver);
        containerRef.current?.removeEventListener('drop', onDrop);
      };

      // The container often gets its FINAL size after init (desktop shell
      // lays out late) — a stale size locks minZoom too high and the whole
      // plan becomes unreachable. Track resizes: refresh Leaflet's cached
      // size, recompute the zoom floor, and re-fit if we were at the floor.
      const container = containerRef.current;
      if (container && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          const wNow = worldRef.current;
          if (!wNow || wNow.map !== map) return;
          const wasAtFloor = map.getZoom() <= map.getMinZoom() + 0.05;
          map.invalidateSize({ animate: false });
          const fitZoom = applyZoomLimits();
          if (fitZoom !== undefined && (wasAtFloor || map.getZoom() < fitZoom - 0.2)) map.fitBounds(bounds);
        });
        ro.observe(container);
        resizeObsRef.current = ro;
      }
    })();
    return () => {
      cancelled = true;
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      if (world) { world.map.remove(); }
      if (worldRef.current === world) worldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision.rasterUrl, revision.width, revision.height]);

  // ---- anchor layers (per anchors/edit change) -----------------------------
  const buildLayers = (w: World) => {
    const { L, map } = w;
    Array.from(w.layers.values()).forEach(l => { l.poly?.remove(); l.pin?.remove(); l.handle?.remove(); });
    w.layers.clear();

    for (const a of anchors) {
      const color = typesByKey[a.typeKey]?.color ?? '#64748B';
      const entry: AnchorLayers = { anchor: a };

      if (a.display === 'pin') {
        // The TYPE decides the shape (marker library): 'label' draws a rounded
        // rectangle (rooms, utility points), 'dot' a circle with the icon.
        const asLabel = (typesByKey[a.typeKey]?.shape ?? 'dot') === 'label';
        const icon = L.divIcon({
          className: `kw-fp-pin${asLabel ? ' kw-fp-label' : ''}`,
          html:
            '<span class="kw-fp-inner">' +
            `<span class="kw-fp-dot">${escapeHtml(typesByKey[a.typeKey]?.icon ?? '📍')}</span>` +
            `<span class="kw-fp-dotlbl">${asLabel ? escapeHtml(typesByKey[a.typeKey]?.icon ?? '') + ' ' : ''}${escapeHtml(a.label)}</span>` +
            '</span>',
          // Zero-size icon anchored EXACTLY at the point; .kw-fp-inner centres
          // the visible content on it (see floorplan.css).
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        const pin = L.marker(fracToLatLng(w, { x: a.cx, y: a.cy }), {
          icon,
          // Edit mode = grab any marker and move it, at whatever zoom you can
          // actually see it. No separate handle, no select-first step.
          draggable: cbRef.current.editable,
          autoPan: true,
        }).addTo(map);
        if (cbRef.current.editable) {
          pin.on('dragend', () => {
            const wNow = worldRef.current;
            if (!wNow || !cbRef.current.onMoveAnchor) return;
            const to = latLngToFrac(wNow, pin.getLatLng());
            const clamp = (v: number) => Math.min(1, Math.max(0, v));
            const dx = clamp(to.x) - a.cx, dy = clamp(to.y) - a.cy;
            const moved = a.polygon.map(p => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) }));
            cbRef.current.onMoveAnchor(a, moved, clamp(to.x), clamp(to.y));
          });
        }
        const el = pin.getElement();
        if (el) el.style.setProperty('--c', color);
        pin.on('click', (e: Leaflet.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e as unknown as Event as never);
          cbRef.current.onTapAnchor(a.locationId);
        });
        entry.pin = pin;
      } else {
        const poly = L.polygon(a.polygon.map(p => fracToLatLng(w, p)), {
          stroke: false, fill: true, fillOpacity: 0, interactive: true,
        }).addTo(map);
        poly.on('click', (e: Leaflet.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e as unknown as Event as never);
          cbRef.current.onTapAnchor(a.locationId);
        });
        entry.poly = poly;
      }

      // Detected-label anchors have no marker of their own to grab, so they
      // keep a handle — but only the selected one, to avoid burying the plan.
      if (cbRef.current.editable && a.display === 'overlay' && a.locationId === selectedId) {
        const handle = L.marker(fracToLatLng(w, { x: a.cx, y: a.cy }), {
          draggable: true,
          icon: L.divIcon({ className: 'kw-fp-handle', iconSize: [26, 26] }),
        }).addTo(map);
        const hel = handle.getElement();
        if (hel) hel.style.setProperty('--c', color);
        handle.on('dragend', () => {
          const wNow = worldRef.current;
          if (!wNow || !cbRef.current.onMoveAnchor) return;
          const to = latLngToFrac(wNow, handle.getLatLng());
          const dx = to.x - a.cx, dy = to.y - a.cy;
          const clamp = (v: number) => Math.min(1, Math.max(0, v));
          const moved = a.polygon.map(p => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) }));
          entry.poly?.setLatLngs(moved.map(p => fracToLatLng(wNow, p)));
          entry.pin?.setLatLng(fracToLatLng(wNow, { x: clamp(to.x), y: clamp(to.y) }));
          cbRef.current.onMoveAnchor(a, moved, clamp(to.x), clamp(to.y));
        });
        entry.handle = handle;
      }

      w.layers.set(a.id, entry);
    }
  };

  const styleLayers = (w: World) => {
    for (const entry of Array.from(w.layers.values())) {
      const a = entry.anchor;
      const color = typesByKey[a.typeKey]?.color ?? '#64748B';
      const isSelected = selectedId != null && a.locationId === selectedId;
      const isFiltered = filterType != null && a.typeKey === filterType;
      if (entry.poly) {
        if (isSelected) {
          entry.poly.setStyle({ stroke: true, color, weight: 3, opacity: 0.95, fill: true, fillColor: color, fillOpacity: 0.15 });
          entry.poly.bringToFront();
          entry.poly.getElement()?.classList.add('kw-fp-poly-sel');
        } else if (isFiltered) {
          entry.poly.setStyle({ stroke: true, color, weight: 2, opacity: 0.75, fill: true, fillColor: color, fillOpacity: 0.06 });
          entry.poly.getElement()?.classList.remove('kw-fp-poly-sel');
        } else if (cbRef.current.editable) {
          entry.poly.setStyle({ stroke: true, color, weight: 1.5, opacity: 0.5, dashArray: '5 4', fill: true, fillOpacity: 0.04, fillColor: color });
          entry.poly.getElement()?.classList.remove('kw-fp-poly-sel');
        } else {
          entry.poly.setStyle({ stroke: false, fill: true, fillOpacity: 0 });
          entry.poly.getElement()?.classList.remove('kw-fp-poly-sel');
        }
      }
      if (entry.pin) {
        const el = entry.pin.getElement();
        if (el) el.classList.toggle('kw-fp-sel', isSelected);
      }
    }
  };

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    buildLayers(w);
    styleLayers(w);
    // selectedId matters here ONLY in edit mode (it decides which anchor owns
    // the drag handle); plain viewing restyles without rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, editable, typesByKey, editable ? selectedId : null]);

  useEffect(() => {
    const w = worldRef.current;
    if (w) styleLayers(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, filterType]);

  // Glide so the target lands ~38% from the top — clear of the bottom sheet.
  const flyRef = useRef<FlyTarget | null>(null);
  flyRef.current = flyTo ?? null;
  const applyFly = (w: World, target: FlyTarget) => {
    const { map } = w;
    const ll = fracToLatLng(w, { x: target.cx, y: target.cy });
    const targetZoom = Math.min(Math.max(map.getZoom(), map.getMinZoom() + 1.4), map.getMaxZoom() - 0.3);
    const pt = map.project(ll, targetZoom);
    const size = map.getSize();
    const center = map.unproject(pt.add([0, size.y * 0.12] as unknown as Leaflet.PointExpression), targetZoom);
    map.flyTo(center, targetZoom, { duration: 0.5 });
  };
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !flyTo) return;
    applyFly(w, flyTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.seq]);

  return <div ref={containerRef} className="kw-fp-viewport h-full w-full" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}
