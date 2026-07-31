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
import { useEffect, useRef, useState } from 'react';
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
  /**
   * True while type chips are narrowing the plan. `anchors` already holds only
   * what survived the filter; this says the survivors should be OUTLINED —
   * a detected label is an invisible tap polygon, so a filter that left only
   * those would otherwise look like an empty plan.
   */
  filtered: boolean;
  editable: boolean;
  onTapAnchor: (locationId: number) => void;
  onTapEmpty?: (pt: Pt) => void;
  onMoveAnchor?: (anchor: ManifestAnchor, polygon: Pt[], cx: number, cy: number) => void;
  /** Move only the pulled-out ICON. The spot it marks does not move. */
  onMovePin?: (anchor: ManifestAnchor, pinCx: number, pinCy: number) => void;
}

interface AnchorLayers {
  anchor: ManifestAnchor;
  poly?: Leaflet.Polygon;
  pin?: Leaflet.Marker;
  handle?: Leaflet.Marker;
  /** Leader line: the arrow from a pulled-out icon back to its spot. */
  leader?: Leaflet.Polyline;
  arrow?: Leaflet.Marker;
  target?: Leaflet.Marker;
}

interface World {
  L: typeof Leaflet;
  map: Leaflet.Map;
  layers: Map<number, AnchorLayers>; // keyed by anchor id
  width: number;
  height: number;
}

/**
 * Point the arrowhead along its leader line.
 *
 * The angle is measured in SCREEN space, never in fractional space: a plan is
 * rarely square, so equal fractions are not equal distances and an angle taken
 * from fractions would visibly miss the spot. CRS.Simple scales uniformly, so
 * an angle measured at one zoom stays correct at every other.
 */
function aimArrow(w: World, entry: AnchorLayers, from: Leaflet.LatLngExpression, to: Leaflet.LatLngExpression): void {
  const host = entry.arrow?.getElement();
  const head = host?.querySelector('.kw-fp-arrowhead') as HTMLElement | null;
  if (!head) return;
  const p1 = w.map.latLngToLayerPoint(w.L.latLng(from));
  const p2 = w.map.latLngToLayerPoint(w.L.latLng(to));
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  // A leader only a few pixels long has no stable direction — the angle would
  // spin wildly on the smallest nudge — and an arrowhead that size is noise.
  if (Math.hypot(dx, dy) < 8) { head.style.display = 'none'; return; }
  head.style.display = '';
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Leaflet owns the marker element's own transform, so the rotation goes on
  // the inner span — the same reason .kw-fp-inner exists (see floorplan.css).
  // translate puts the arrow's TIP on the spot; transform-origin (set in CSS
  // to the tip) makes the rotation swing the body around that fixed point.
  head.style.transform = `translate(-100%, -50%) rotate(${deg}deg)`;
}

export default function FloorplanMap({
  revision, anchors, typesByKey, selectedId, filtered, editable,
  onTapAnchor, onTapEmpty, onMoveAnchor, onMovePin, flyTo, onDropType,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  /** Bumped when a map finishes initialising, so effects can wait for one. */
  const [mapReady, setMapReady] = useState(0);
  /** True while a marker is being dragged — see the declutter effect. */
  const draggingRef = useRef(false);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // Callbacks kept current without re-initializing the map.
  const cbRef = useRef({ onTapAnchor, onTapEmpty, onMoveAnchor, onMovePin, onDropType, editable });
  cbRef.current = { onTapAnchor, onTapEmpty, onMoveAnchor, onMovePin, onDropType, editable };

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
      // Same shape as the fly-target note below: the declutter effect runs
      // BEFORE this async import resolves, finds no world and installs
      // nothing. Announcing readiness re-runs it, or labels stay overlapping
      // on a cold load until something else happens to change.
      setMapReady(r => r + 1);
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
    // Removing a marker mid-drag can end the drag without Leaflet emitting the
    // marker's dragend, which would strand the flag at true and silence the
    // declutter pass for the rest of the session. A rebuild always clears it.
    draggingRef.current = false;
    Array.from(w.layers.values()).forEach(l => {
      l.poly?.remove(); l.pin?.remove(); l.handle?.remove();
      l.leader?.remove(); l.arrow?.remove(); l.target?.remove();
    });
    w.layers.clear();

    for (const a of anchors) {
      const color = typesByKey[a.typeKey]?.color ?? '#64748B';
      const entry: AnchorLayers = { anchor: a };

      if (a.display === 'pin') {
        // The TYPE decides the shape (marker library): 'label' draws a rounded
        // rectangle (rooms, utility points), 'dot' a circle with the icon.
        const shape = typesByKey[a.typeKey]?.shape ?? 'dot';
        const asLabel = shape === 'label';
        const icon = L.divIcon({
          className: `kw-fp-pin${asLabel ? ' kw-fp-label' : ''}`,
          html:
            '<span class="kw-fp-inner">' +
            `<span class="kw-fp-dot kw-fp-shape-${escapeHtml(shape)}"><span>${escapeHtml(typesByKey[a.typeKey]?.icon ?? '📍')}</span></span>` +
            `<span class="kw-fp-dotlbl">${asLabel ? escapeHtml(typesByKey[a.typeKey]?.icon ?? '') + ' ' : ''}${escapeHtml(a.label)}</span>` +
            '</span>',
          // Zero-size icon anchored EXACTLY at the point; .kw-fp-inner centres
          // the visible content on it (see floorplan.css).
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        // A pulled-out icon is DRAWN away from the spot it marks, with an
        // arrow between the two. cx/cy remain the spot; pinCx/pinCy are only
        // where the icon sits, so a crowded room can push its icons outside.
        const pulledOut = a.pinCx != null && a.pinCy != null;
        const drawAt = pulledOut ? { x: a.pinCx!, y: a.pinCy! } : { x: a.cx, y: a.cy };
        const spotAt = { x: a.cx, y: a.cy };

        const pin = L.marker(fracToLatLng(w, drawAt), {
          icon,
          // Edit mode = grab any marker and move it, at whatever zoom you can
          // actually see it. No separate handle, no select-first step.
          draggable: cbRef.current.editable,
          autoPan: true,
        }).addTo(map);
        if (cbRef.current.editable) {
          pin.on('dragstart', () => { draggingRef.current = true; });
          pin.on('dragend', () => { draggingRef.current = false; });
          // While the icon is out, dragging it moves ONLY the icon — the spot
          // stays where it is. Redraw the arrow live so it never lags behind.
          if (pulledOut) {
            pin.on('drag', () => {
              const wNow = worldRef.current;
              if (!wNow) return;
              entry.leader?.setLatLngs([pin.getLatLng(), fracToLatLng(wNow, spotAt)]);
              aimArrow(wNow, entry, pin.getLatLng(), fracToLatLng(wNow, spotAt));
            });
            pin.on('dragend', () => {
              const wNow = worldRef.current;
              if (!wNow || !cbRef.current.onMovePin) return;
              const to = latLngToFrac(wNow, pin.getLatLng());
              const clamp = (v: number) => Math.min(1, Math.max(0, v));
              cbRef.current.onMovePin(a, clamp(to.x), clamp(to.y));
            });
          } else {
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
        }

        if (pulledOut) {
          const from = fracToLatLng(w, drawAt), to = fracToLatLng(w, spotAt);
          entry.leader = L.polyline([from, to], {
            className: 'kw-fp-leader', color, weight: 2, opacity: 0.9, interactive: false,
          }).addTo(map);
          entry.arrow = L.marker(to, {
            icon: L.divIcon({ className: 'kw-fp-arrow', html: '<span class="kw-fp-arrowhead"></span>', iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false,
            // Under the icon and the spot handle — it is a pointer, not a target.
            zIndexOffset: -100,
          }).addTo(map);
          const ael = entry.arrow.getElement();
          if (ael) ael.style.setProperty('--c', color);
          aimArrow(w, entry, from, to);

          // The spot end is draggable too, so the real position stays editable
          // once the icon has been moved away from it.
          if (cbRef.current.editable) {
            const target = L.marker(to, {
              draggable: true,
              icon: L.divIcon({ className: 'kw-fp-spot', iconSize: [22, 22] }),
            }).addTo(map);
            const tel = target.getElement();
            if (tel) tel.style.setProperty('--c', color);
            target.on('dragstart', () => { draggingRef.current = true; });
            target.on('dragend', () => { draggingRef.current = false; });
            target.on('drag', () => {
              const wNow = worldRef.current;
              if (!wNow) return;
              entry.leader?.setLatLngs([pin.getLatLng(), target.getLatLng()]);
              entry.arrow?.setLatLng(target.getLatLng());
              aimArrow(wNow, entry, pin.getLatLng(), target.getLatLng());
            });
            target.on('dragend', () => {
              const wNow = worldRef.current;
              if (!wNow || !cbRef.current.onMoveAnchor) return;
              const t = latLngToFrac(wNow, target.getLatLng());
              const clamp = (v: number) => Math.min(1, Math.max(0, v));
              const dx = clamp(t.x) - a.cx, dy = clamp(t.y) - a.cy;
              const moved = a.polygon.map(p => ({ x: clamp(p.x + dx), y: clamp(p.y + dy) }));
              cbRef.current.onMoveAnchor(a, moved, clamp(t.x), clamp(t.y));
            });
            entry.target = target;
          }
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
        handle.on('dragstart', () => { draggingRef.current = true; });
        handle.on('dragend', () => { draggingRef.current = false; });
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

  /**
   * Label decluttering.
   *
   * Two fridges standing side by side in the real room put their icons within
   * a few pixels of each other, and their names then print on top of one
   * another — unreadable exactly where being readable matters most.
   *
   * So after every build, zoom and pan: measure each label ON SCREEN, and walk
   * the collisions apart downwards. A label that finds a free slot keeps its
   * full text and grows a short connector back to its dot. One that cannot fit
   * anywhere hides, leaving its dot — which is still tappable, and the sheet
   * gives the name. Nothing here touches stored data; it is pure presentation,
   * recomputed from what is actually visible.
   *
   * Priority is deliberate: the SELECTED spot always gets first choice, so the
   * one you are looking for is never the one that gets hidden. Rooms are
   * landmarks — never moved, never hidden, but they do occupy space that item
   * labels must route around.
   */
  const declutter = (w: World) => {
    type R = { l: number; t: number; r: number; b: number };
    const overlaps = (a: R, b: R) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    // Leaflet clips its container, so a slot outside it is not a free slot —
    // it is an invisible one. A label with nowhere visible to sit should hide
    // and leave its dot, not be seated somewhere no one can read it.
    // Leaflet clips its container, so a slot outside it is not a free slot.
    // Only the VERTICAL axis is tested, because that is the only axis this
    // pass moves: a label clipped at the left or right edge is clipped
    // identically at every candidate offset, so judging it there would hide
    // labels for a reason no amount of nudging could fix.
    const cb = containerRef.current?.getBoundingClientRect();
    const inView = (x: R) => !cb || (x.t >= cb.top && x.b <= cb.bottom);
    const taken: R[] = [];
    const movable: Array<{ el: HTMLElement; rect: R; selected: boolean; dotH: number }> = [];

    for (const entry of Array.from(w.layers.values())) {
      const host = entry.pin?.getElement();
      const el = host?.querySelector('.kw-fp-dotlbl') as HTMLElement | null;
      if (!host || !el) continue;
      // Clear last pass before measuring, or offsets would compound each zoom.
      el.style.removeProperty('--lbl-dy');
      el.style.removeProperty('--lbl-conn');
      el.classList.remove('kw-fp-lbl-hidden', 'kw-fp-lbl-up');

      // The DOTS are obstacles too, and this is the case that actually bites:
      // one marker's icon landing on its neighbour's NAME. Dots never move —
      // a dot marks a real position — so they are reserved before any label.
      const dot = host.querySelector('.kw-fp-dot') as HTMLElement | null;
      let dotH = 0;
      if (dot && !host.classList.contains('kw-fp-label')) {
        const d = dot.getBoundingClientRect();
        if (d.width > 0) {
          taken.push({ l: d.left, t: d.top, r: d.right, b: d.bottom });
          dotH = d.height;   // measured, so --kw-fp-dot stays the one source of truth
        }
      }

      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;   // not laid out yet
      const rect: R = { l: b.left, t: b.top, r: b.right, b: b.bottom };
      if (host.classList.contains('kw-fp-label')) taken.push(rect);
      else movable.push({ el, rect, selected: entry.anchor.locationId === selectedId, dotH });
    }

    movable.sort((a, z) => Number(z.selected) - Number(a.selected) || a.rect.t - z.rect.t);

    for (const m of movable) {
      // Step by the label's own height so a nudged label clears the one above
      // it rather than landing half on top of it. Try DOWN first (the resting
      // place, so the common case looks conventional), then the mirrored slot
      // ABOVE — a label boxed in below often has clear space over its dot, and
      // hiding it while that space sits empty would be a poor trade.
      //
      // A slot that lands on the marker's OWN dot needs no special case: every
      // dot is already an obstacle, so the collision test rejects it.
      const step = (m.rect.b - m.rect.t) + 4;
      const offsets: number[] = [0];
      for (let i = 1; i <= 4; i++) offsets.push(i * step, -i * step);
      let seated = false;
      for (const dy of offsets) {
        const cand: R = { l: m.rect.l, t: m.rect.t + dy, r: m.rect.r, b: m.rect.b + dy };
        if (!inView(cand) || taken.some(t => overlaps(cand, t))) continue;
        if (dy !== 0) {
          // Connector length is NOT |dy|. Downwards the thread spans the gap
          // that opened above the label (dy plus its 3px resting gap).
          // Upwards it hangs from the label's underside and must stop at the
          // TOP of the dot, so the label's own height, the resting gap AND the
          // dot's height all come out of it — otherwise the thread is drawn
          // straight through the marker it is pointing at.
          const h = m.rect.b - m.rect.t;
          const conn = dy > 0 ? dy + 3 : Math.max(0, -dy - h - 3 - m.dotH);
          m.el.style.setProperty('--lbl-dy', `${dy}px`);
          m.el.style.setProperty('--lbl-conn', `${conn}px`);
          m.el.classList.toggle('kw-fp-lbl-up', dy < 0);
        }
        taken.push(cand);
        seated = true;
        break;
      }
      // Nowhere to sit: the dot stays and still opens the sheet on tap.
      if (!seated) m.el.classList.add('kw-fp-lbl-hidden');
    }
  };

  const styleLayers = (w: World) => {
    for (const entry of Array.from(w.layers.values())) {
      const a = entry.anchor;
      const color = typesByKey[a.typeKey]?.color ?? '#64748B';
      const isSelected = selectedId != null && a.locationId === selectedId;
      const isFiltered = filtered;
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
      // Where several icons have been pulled out of the same corner, the lines
      // cross. Thickening the selected one shows which spot you are holding.
      if (entry.leader) {
        entry.leader.setStyle({ color, weight: isSelected ? 3.5 : 2, opacity: isSelected ? 1 : 0.9 });
        if (isSelected) entry.leader.bringToFront();
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
    //
    // mapReady is a dependency for the cold-load race: the map is built after
    // an async leaflet import, and anything that changed the anchor list while
    // that import was in flight (a type chip tapped on a slow connection) found
    // no world here and did nothing. Leaflet would then keep the list captured
    // at import time. Rebuilding on readiness costs one repeat build and makes
    // the plan always agree with the chips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, editable, typesByKey, editable ? selectedId : null, mapReady]);

  useEffect(() => {
    const w = worldRef.current;
    if (w) styleLayers(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, filtered, mapReady]);

  // Declutter AFTER the layer effects above, and again whenever the view
  // changes — which labels collide depends entirely on the current zoom.
  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    let frame = 0;
    const run = () => {
      // Skip entirely mid-drag. A marker dragged near the edge triggers
      // Leaflet's autoPan, which emits moveend per animation frame — running a
      // full measure-and-seat pass on each one makes a busy plan drag badly.
      // The dragend handlers rebuild anchors, which re-runs this effect.
      if (draggingRef.current) return;
      // One frame late: Leaflet writes marker transforms during the event, so
      // measuring immediately would read the positions we are replacing.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => declutter(w));
    };
    run();
    w.map.on('zoomend', run);
    w.map.on('moveend', run);
    return () => {
      cancelAnimationFrame(frame);
      w.map.off('zoomend', run);
      w.map.off('moveend', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, editable, typesByKey, selectedId, filtered, mapReady]);

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
