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
  onTapAnchor, onTapEmpty, onMoveAnchor, flyTo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  // Callbacks kept current without re-initializing the map.
  const cbRef = useRef({ onTapAnchor, onTapEmpty, onMoveAnchor, editable });
  cbRef.current = { onTapAnchor, onTapEmpty, onMoveAnchor, editable };

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
      map.fitBounds(bounds);
      const fitZoom = map.getBoundsZoom(bounds);
      map.setMinZoom(fitZoom - 0.4);
      map.setMaxZoom(fitZoom + 3.2);
      map.setMaxBounds(bounds.pad(0.35));
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        const w = worldRef.current;
        if (w && cbRef.current.onTapEmpty) cbRef.current.onTapEmpty(latLngToFrac(w, e.latlng));
      });

      world = { L, map, layers: new Map(), width: revision.width, height: revision.height };
      worldRef.current = world;
      buildLayers(world);
      styleLayers(world);
    })();
    return () => {
      cancelled = true;
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
        const icon = L.divIcon({
          className: 'kw-fp-pin',
          html: `<span>${typesByKey[a.typeKey]?.icon ?? '📍'}</span>${escapeHtml(a.label)}`,
          iconSize: undefined,
        });
        const pin = L.marker(fracToLatLng(w, { x: a.cx, y: a.cy }), { icon }).addTo(map);
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

      if (cbRef.current.editable) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, editable, typesByKey]);

  useEffect(() => {
    const w = worldRef.current;
    if (w) styleLayers(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, filterType]);

  // Glide so the target lands ~38% from the top — clear of the bottom sheet.
  useEffect(() => {
    const w = worldRef.current;
    if (!w || !flyTo) return;
    const { map } = w;
    const ll = fracToLatLng(w, { x: flyTo.cx, y: flyTo.cy });
    const targetZoom = Math.min(Math.max(map.getZoom(), map.getMinZoom() + 1.4), map.getMaxZoom() - 0.3);
    const pt = map.project(ll, targetZoom);
    const size = map.getSize();
    const center = map.unproject(pt.add([0, size.y * 0.12] as unknown as Leaflet.PointExpression), targetZoom);
    map.flyTo(center, targetZoom, { duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.seq]);

  return <div ref={containerRef} className="kw-fp-viewport h-full w-full" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}
