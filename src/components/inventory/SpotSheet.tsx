'use client';

import React, { useState, useEffect, useMemo } from 'react';
import CollapsibleNode from '@/components/ui/CollapsibleNode';
import { collapseAll, expandAll, expandedCount, setExpanded } from '@/lib/tree-expansion';
import { Spinner, ProductThumb } from './ui';
import { buildLocationTree } from '@/lib/location-tree';
import { useLocationTypes } from '@/lib/use-location-types';
import { suggestedChildTypes } from '@/lib/location-types';
import LocationForm from './LocationForm';
import LocationManager from './LocationManager';

/**
 * "Where does it live?" — edit ONE product's home spots (multi-select).
 *
 * The home spots are the single global record (product_locations) that every
 * door edits: the Locations screen, Product Settings and the list builder all
 * open this same sheet / write the same rows. Saving affects every list that
 * contains the product (future counts — open counts keep their frozen snapshot).
 *
 * Locations are grouped by area, each with its photo + "where to stand" note
 * so the manager assigns by sight. Ticking nothing = "no specific spot": the
 * product counts under "Everything else".
 */
interface SpotRow {
  id: number;
  parent_id: number | null;
  name: string;
  kind: string;
  photo: string | null;
  description: string | null;
  sort_order: number;
}

export default function SpotSheet({ product, hasImage, companyId, initialSpotIds, onSaved, onClose, baseZ = 110 }: {
  product: { id: number; name: string };
  hasImage: boolean;
  companyId: number;
  /** The product's current home spots (from the caller's placement map). */
  initialSpotIds: number[];
  /** Called with the saved spot ids so the caller can update its map. */
  onSaved: (spotIds: number[]) => void;
  onClose: () => void;
  /** z-index so this can stack above a ProductDetail overlay. */
  baseZ?: number;
}) {
  const [spots, setSpots] = useState<SpotRow[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set(initialSpotIds));
  const [loading, setLoading] = useState(true);
  // Save stays DISABLED until both the spots and the product's CURRENT home
  // spots are loaded — saving from a stale/failed state could overwrite newer
  // placements made elsewhere. Fail closed, never open.
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  // Opt-in, default OFF: also rebuild today's not-yet-started counts for this
  // product's lists. Default off because this sheet is a SHARED door (list
  // builder, Product Settings, Locations) — a stray edit must never silently
  // re-order a count someone is about to start. (The server guard makes even an
  // accidental opt-in harmless to counts already begun.)
  const [applyToday, setApplyToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // new-location form: null = closed, else the initial for the new node
  // (parent_id + a default kind when adding INSIDE another level).
  const [creating, setCreating] = useState<{ parent_id?: number | null; kind?: string } | null>(null);
  const [editMode, setEditMode] = useState(false);   // "Edit levels" — reveal add/rename/type/delete controls
  // Drill-down picker: null = closed; else the ids drilled into so far
  // ([] = choosing the area, [12] = choosing what's inside location 12, …).
  const [picking, setPicking] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<SpotRow | null>(null);   // location whose details are being edited
  const [managing, setManaging] = useState(false);   // full Locations manager open as an overlay
  // Resolve type icons incl. this company's CUSTOM types (built-ins + custom).
  const { iconOf } = useLocationTypes(companyId);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Creating/editing a location + managing types all require this capability —
  // gate the affordances on it so a template-only user never hits a 403 dead-end.
  const [canManageLocations, setCanManageLocations] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      setCanManageLocations(((d?.user?.capabilities as string[]) || []).includes('inventory.location.manage'));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Spots AND the product's CURRENT home spots — fetched fresh on open so
        // a stale caller map (failed load / edited elsewhere) can never cause
        // this sheet to overwrite newer placements on save.
        const [locRes, curRes] = await Promise.all([
          fetch(`/api/inventory/count-locations?company_id=${companyId}`),
          fetch(`/api/inventory/product-locations?product_id=${product.id}`),
        ]);
        if (!locRes.ok || !curRes.ok) throw new Error('load');
        const d = await locRes.json();
        const locs: SpotRow[] = d.locations || [];
        setSpots(locs);
        const cur = await curRes.json();
        const companySpots = new Set(locs.map((l) => l.id));
        setChosen(new Set<number>((cur.location_ids || []).filter((id: number) => companySpots.has(id))));
        setReady(true);
      } catch {
        setError('Could not load this product’s spots — close and try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId, product.id]);

  // Areas (roots) with their child spots, in walking order.
  const tree = useMemo(() => buildLocationTree(spots as SpotRow[]), [spots]);
  // Per-screen scope, per product: opening the map for one product should not
  // decide how it opens for the next.
  const spotScope = `spots:${product.id}`;

  const byId = useMemo(() => new Map<number, SpotRow>(spots.map((s) => [s.id, s] as [number, SpotRow])), [spots]);
  const childrenOf = useMemo(() => {
    const m = new Map<number, SpotRow[]>();
    const live = new Set(spots.map((s) => s.id));
    spots.forEach((s) => {
      // Same rule as buildLocationTree: a node whose parent is missing counts as
      // a ROOT — otherwise an orphaned spot would be unreachable in the drill-down.
      const k = s.parent_id != null && live.has(s.parent_id) ? s.parent_id : 0;
      const arr = m.get(k) || [];
      arr.push(s);
      m.set(k, arr);
    });
    m.forEach((arr) => arr.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
    return m;
  }, [spots]);
  const kidsOf = (id: number | null) => childrenOf.get(id ?? 0) || [];

  /** Full path top→self (cycle-guarded). */
  const pathOf = React.useCallback((id: number): SpotRow[] => {
    const out: SpotRow[] = [];
    const guard = new Set<number>();
    let cur: number | null = id;
    while (cur != null && byId.has(cur) && !guard.has(cur)) {
      guard.add(cur);
      const n: SpotRow = byId.get(cur)!;
      out.unshift(n);
      cur = n.parent_id ?? null;
    }
    return out;
  }, [byId]);

  /** Is `a` an ancestor of `b`? (a strictly contains b) */
  const contains = React.useCallback((a: number, b: number) => {
    if (a === b) return false;
    return pathOf(b).some((n) => n.id === a);
  }, [pathOf]);

  // OVERLAPPING picks are the core error this sheet used to allow: a product
  // counted at BOTH a unit and a place inside it (e.g. "Countertop fridge" AND
  // "D4") is counted twice, because every picked place is its own count line and
  // approval SUMS them. Surface any existing overlap with a one-tap fix.
  const overlaps = useMemo(() => {
    const ids = Array.from(chosen).filter((id) => byId.has(id));
    const pairs: { outer: number; inner: number }[] = [];
    ids.forEach((a) => ids.forEach((b) => { if (contains(a, b)) pairs.push({ outer: a, inner: b }); }));
    return pairs;
  }, [chosen, byId, contains]);

  // While a save is in flight the request already carries a snapshot of `chosen`
  // and the sheet closes on success — so a later edit would be silently lost.
  // Every mutation below no-ops during a save (the controls are disabled too).
  function removePlace(id: number) {
    if (saving) return;
    setChosen((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  /**
   * Resolve EVERY overlap at once by keeping only the most precise places: drop
   * any picked place that contains another picked place. Pairwise removal isn't
   * enough — with Area + Unit + Drawer all picked, fixing the Area/Drawer pair
   * would leave Unit + Drawer still overlapping.
   */
  function keepMostPrecise() {
    if (saving) return;
    setChosen((prev) => {
      const ids = Array.from(prev).filter((id) => byId.has(id));
      return new Set(ids.filter((a) => !ids.some((b) => contains(a, b))));
    });
    setError(null);
  }

  /** Pick a place, refusing to keep a pick that overlaps it (ancestor OR descendant). */
  function choosePlace(id: number) {
    if (saving) return;
    const clashes = Array.from(chosen).filter((c) => c !== id && (contains(c, id) || contains(id, c)));
    if (clashes.length > 0) {
      const names = clashes.map((c) => byId.get(c)?.name || `#${c}`).join(', ');
      const me = byId.get(id)?.name || `#${id}`;
      const ok = confirm(
        `“${me}” overlaps with ${names}.\n\nA product is counted at EVERY place you pick, so keeping both would count this product twice.\n\nReplace ${names} with “${me}”?`,
      );
      if (!ok) return;
    }
    setChosen((prev) => {
      const n = new Set(prev);
      clashes.forEach((c) => n.delete(c));
      n.add(id);
      return n;
    });
    setPicking(null);
  }

  async function save() {
    if (saving) return;
    // Fail closed on overlapping places: every picked place is its own count line
    // and approval SUMS them, so a unit + something inside it silently inflates
    // stock. REFUSE — the banner's one-tap fix resolves it. (The API enforces the
    // same rule, so no other door can write a bad pair either.)
    if (overlaps.length > 0) {
      setError('Two places overlap (one is inside the other) — that would count this product twice. Use “Keep the most precise places” above.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/product-locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odoo_product_id: product.id,
          company_id: companyId,
          count_location_ids: Array.from(chosen),
          apply_today: applyToday,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Could not save — try again.');
        return;
      }
      onSaved(Array.from(chosen));
      onClose();
    } catch {
      setError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshSpots() {
    const r = await fetch(`/api/inventory/count-locations?company_id=${companyId}`);
    if (r.ok) setSpots((await r.json()).locations || []);
  }

  // Returning from the full Locations manager: reload the spots so any new
  // area/sub-spot is tickable, and PRUNE the current selection to spots that
  // still exist (the manager may have deleted one) — so save can't write a dead
  // id. The user's other (surviving) ticks are preserved.
  async function reloadFromManager() {
    try {
      const r = await fetch(`/api/inventory/count-locations?company_id=${companyId}`);
      if (!r.ok) return;
      const locs: SpotRow[] = (await r.json()).locations || [];
      setSpots(locs);
      const live = new Set(locs.map((l) => l.id));
      setChosen((prev) => new Set(Array.from(prev).filter((id) => live.has(id))));
    } catch { /* keep what we have — a failed refresh must not drop selections */ }
  }

  // Quick-create a location without leaving the picker (no navigation dead-end):
  // the SAME shared LocationForm the Locations manager uses. New locations are
  // top-level areas (reorganise later in the manager); auto-ticked on create.
  async function createLocation(loc: { parent_id?: number | null; name?: string; kind?: string; description?: string | null; photo?: string | null }) {
    setFormSaving(true); setFormError(null);
    const parentId = loc.parent_id ?? null;
    try {
      const res = await fetch('/api/inventory/count-locations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, parent_id: parentId, name: loc.name, kind: loc.kind, description: loc.description ?? null, photo: loc.photo ?? null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFormError(d.error || 'Could not create the location'); return; }
      const { id: newId } = await res.json();
      // Success — show the new location immediately (optimistic), so a failed
      // background refresh can't hide a location that WAS created. It is NOT
      // auto-assigned to the product: creating a level is a STRUCTURE edit, and
      // auto-picking a child of an already-picked unit would build the exact
      // overlapping pair this sheet exists to prevent. Assign via "+ Add a place".
      if (newId) {
        const newRow: SpotRow = { id: newId, parent_id: parentId, name: (loc.name || '').trim(), kind: loc.kind || 'area', photo: loc.photo ?? null, description: loc.description ?? null, sort_order: 9999 };
        setSpots((prev) => prev.some((s) => s.id === newId) ? prev : [...prev, newRow]);
        // Branches are collapsed by default now, so a level added into a closed
        // parent would land out of sight. Open the parent instead of leaving the
        // manager wondering whether the tap worked.
        if (parentId != null) setExpanded(spotScope, parentId, true);
      }
      setCreating(null);
      refreshSpots().catch(() => {});   // best-effort reconcile (real sort_order/parent)
    } catch { setFormError('Network error — location not created'); }
    finally { setFormSaving(false); }
  }

  // Edit a location's details in place (no dead-end): opens the SAME shared
  // LocationForm on the tapped spot, PUTs the change, then refreshes the list so
  // the new name/photo/note shows immediately. Selection (chosen) is unaffected.
  async function updateLocation(loc: { name?: string; kind?: string; description?: string | null; photo?: string | null }) {
    if (!editing) return;
    setFormSaving(true); setFormError(null);
    try {
      const res = await fetch('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, name: loc.name, kind: loc.kind, description: loc.description ?? null, photo: loc.photo ?? null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFormError(d.error || 'Could not save the location'); return; }
      // Success — reflect the edit locally so it shows even if the refresh
      // fails, and so a refresh network error is never reported as "not saved".
      const eid = editing.id;
      setSpots((prev) => prev.map((s) => s.id === eid
        ? { ...s, name: (loc.name ?? s.name), kind: (loc.kind ?? s.kind), description: loc.description ?? null, photo: loc.photo ?? null }
        : s));
      setEditing(null);
      refreshSpots().catch(() => {});   // best-effort reconcile
    } catch { setFormError('Network error — not saved'); }
    finally { setFormSaving(false); }
  }

  // Delete a location straight from the pencil — the SAME cascade delete the
  // Locations manager runs (removes the spot, its sub-spots and placements from
  // EVERY list, not just this product), behind the manager's own confirm. On
  // success reload + prune the selection so a now-gone spot can't be saved.
  async function deleteLocation(loc: SpotRow) {
    if (!confirm('Remove this location and everything under it?')) return;
    setFormSaving(true); setFormError(null);
    try {
      const res = await fetch(`/api/inventory/count-locations?id=${loc.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setFormError(d.error || 'Could not remove this location'); return; }
      setEditing(null);
      await reloadFromManager();   // refetch (reflects the cascade) + prune chosen to survivors
    } catch { setFormError('Network error — not removed'); }
    finally { setFormSaving(false); }
  }

  // One tickable location row. `isArea` (a top-level unit) shows its photo + a
  // bolder name; a child spot is a plain row. The row IS the unit — there is no
  // separate header, so a unit never appears twice.
  function SpotToggle({ s, isArea = false }: { s: SpotRow; isArea?: boolean }) {
    const on = chosen.has(s.id);
    return (
      <div className={`w-full flex items-center rounded-xl border transition-colors ${
        on && !editMode ? 'bg-green-50 border-green-500' : 'bg-white border-gray-200'
      }`}>
        <button onClick={() => (editMode ? (setFormError(null), setEditing(s)) : choosePlace(s.id))} disabled={saving}
          className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left active:opacity-80">
          {/* In Edit mode the tree is for SHAPING the map (no ticking) — the
              product's places are picked in the drill-down instead. */}
          {!editMode && (
            <span className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${on ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white'}`}>
              {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
            </span>
          )}
          {isArea && s.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.photo} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
          )}
          <span className="flex-1 min-w-0">
            <span className={`block truncate text-[var(--fs-base)] ${isArea ? 'font-bold' : 'font-semibold'} ${on ? 'text-green-900' : 'text-gray-800'}`}>{iconOf(s.kind)} {s.name}</span>
            {s.description && <span className="block truncate text-[var(--fs-xs)] font-normal text-gray-500">{s.description}</span>}
          </span>
        </button>
        {/* Edit mode actions live ON the row: add a level inside, or rename /
            retype / delete this one. They used to be a full-width
            "+ Add inside <NAME>" pill under every single node, which doubled the
            row count and repeated the name twice per level — Ethan, seeing the
            result: "this is quite messy and confusing". */}
        {canManageLocations && editMode && (
          <>
            <button
              onClick={() => setCreating({ parent_id: s.id, kind: suggestedChildTypes(s.kind)[0]?.key || 'shelf' })}
              disabled={saving} aria-label={`Add a level inside ${s.name}`} title={`Add inside ${s.name}`}
              className="px-2.5 py-2.5 text-green-700 active:text-green-900 flex-shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button onClick={() => { setFormError(null); setEditing(s); }} disabled={saving} aria-label={`Edit ${s.name}`}
              className="pl-1 pr-3 py-2.5 text-gray-400 active:text-gray-700 flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </>
        )}
      </div>
    );
  }

  // Render one location node and, indented beneath it, its children — RECURSIVELY
  // to any depth. Top-level nodes render as areas (photo + bold name); every
  // deeper node is a plain tickable row. Each node at every level is tickable
  // (its SpotToggle checkbox) and editable (the pencil), and its own children
  // nest inside the same left-rail indent, one level deeper each time.
  /** Everything below a node, at any depth — what a closed row summarises. */
  function countBelow(node: any): number {
    let n = 0;
    const walk = (kids: any[]) => { for (const k of kids) { n++; walk(k.children || []); } };
    walk(node.children || []);
    return n;
  }

  /**
   * Does this branch hold a TICKED spot?
   *
   * It must then stay open. A chosen shelf hidden inside a collapsed room is a
   * selection the user cannot see — and on this screen that is a place staff will
   * be sent to count, so silently hiding it is worse than a long list. This is the
   * one thing the Locations manager did not have to worry about.
   */
  function hasChosenInside(node: any): boolean {
    for (const k of (node.children || [])) {
      if (chosen.has(k.id) || hasChosenInside(k)) return true;
    }
    return false;
  }

  function renderNode(node: any, isTop: boolean) {
    const kids = node.children || [];
    return (
      <CollapsibleNode
        key={node.id}
        scope={spotScope}
        id={node.id}
        label={node.name}
        insideCount={countBelow(node)}
        // Collapsed unless you open it — building the map used to force every
        // branch open at once, which is what made this screen a wall. Only a
        // branch holding a ticked spot still opens itself, because a hidden
        // selection is worse than a long list.
        forceOpen={hasChosenInside(node)}
        className={isTop ? 'mb-3' : undefined}
        row={(
          /* The unit itself is ONE tickable row (photo + name + note + edit) —
             no separate header, so it can't appear twice. */
          <SpotToggle s={node} isArea={isTop} />
        )}
      >
        {kids.length > 0 ? kids.map((c: any) => renderNode(c, false)) : null}
      </CollapsibleNode>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label={`Home spots for ${product.name}`}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">Where does it live?</h3>
            <div className="flex items-center gap-4">
              {canManageLocations && (
                <button onClick={() => { if (saving) return; setPicking(null); setEditMode((v) => !v); }} disabled={saving} className={`text-[var(--fs-sm)] font-semibold active:opacity-70 ${editMode ? 'text-green-700' : 'text-blue-700'}`}>
                  {editMode ? 'Done' : 'Edit levels'}
                </button>
              )}
              <button onClick={onClose} disabled={saving} className="text-gray-500 font-semibold active:opacity-70 disabled:opacity-40">Cancel</button>
            </div>
          </div>
          <div className="flex items-center gap-2.5 mt-2">
            <ProductThumb productId={product.id} has={hasImage} size={36} />
            <div className="min-w-0">
              <div className="text-[var(--fs-base)] font-bold text-gray-900 truncate">{product.name}</div>
              <div className="text-[var(--fs-xs)] text-gray-500">
                {editMode
                  ? 'Building the map — tap ＋ on a row to add a level inside it, ✎ to rename, retype or delete'
                  : 'Where it’s stored, shared by every counting list — pick the exact place, area by area'}
              </div>
            </div>
          </div>
        </div>

        {/* Both modes collapse now, so the control belongs in both. */}
        {!loading && tree.length > 0 && (
          <div className="px-4 pt-2 flex justify-end">
            <button
              onClick={() => {
                if (expandedCount(spotScope) > 0) collapseAll(spotScope);
                else expandAll(spotScope, spots.map((sp) => sp.id));
              }}
              className="text-[var(--fs-sm)] font-semibold text-green-700 px-2 py-1 active:opacity-70"
            >
              {expandedCount(spotScope) > 0 ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? <Spinner /> : tree.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-[var(--fs-sm)]">
              {canManageLocations
                ? 'No locations yet — tap “Edit levels” above to add your first one.'
                : 'No locations set up yet — ask your manager to add them.'}
            </p>
          ) : editMode ? (
            tree.map((area: any) => renderNode(area, true))
          ) : picking !== null ? (
            /* ---- DRILL-DOWN: one level at a time, always Area → … → exact place ---- */
            (() => {
              const hereId = picking.length > 0 ? picking[picking.length - 1] : null;
              const here = hereId != null ? byId.get(hereId) : undefined;
              const options = kidsOf(hereId);
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <button onClick={() => setPicking(picking.length > 0 ? picking.slice(0, -1) : null)} disabled={saving}
                      className="text-green-700 text-[var(--fs-sm)] font-semibold flex items-center gap-1 active:opacity-70">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
                      Back
                    </button>
                  </div>
                  <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">
                    {here ? `What’s inside ${here.name}?` : 'Which area?'}
                  </p>
                  {picking.length > 0 && (
                    <p className="text-[var(--fs-xs)] text-gray-500 mb-3">
                      {picking.map((id, i) => (
                        <span key={id}>{i > 0 && <span className="text-gray-300"> › </span>}{iconOf(byId.get(id)?.kind)} {byId.get(id)?.name}</span>
                      ))}
                    </p>
                  )}
                  {/* Stop here: the product sits in this unit itself, not in a sub-level. */}
                  {here && (
                    <button onClick={() => choosePlace(here.id)} disabled={saving}
                      className="w-full mb-3 py-3 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-50">
                      ✓ It lives right here — in {here.name}
                    </button>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {options.length === 0 ? (
                      <p className="text-center text-gray-400 py-6 text-[var(--fs-sm)]">
                        Nothing inside {here?.name} yet{canManageLocations ? ' — use “Edit levels” to add shelves or drawers.' : '.'}
                      </p>
                    ) : options.map((o) => {
                      const grand = kidsOf(o.id).length;
                      return (
                        <button key={o.id} onClick={() => (grand > 0 ? setPicking([...picking, o.id]) : choosePlace(o.id))} disabled={saving}
                          className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl border border-gray-200 bg-white text-left active:bg-gray-50 disabled:opacity-50">
                          <span className="text-[var(--fs-lg)] flex-shrink-0">{iconOf(o.kind)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-semibold text-gray-800">{o.name}</span>
                            {(o.description || grand > 0) && (
                              <span className="block truncate text-[var(--fs-xs)] text-gray-500">
                                {grand > 0 ? `${grand} inside` : ''}{grand > 0 && o.description ? ' · ' : ''}{o.description || ''}
                              </span>
                            )}
                          </span>
                          {grand > 0
                            ? <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
                            : <span className="text-[var(--fs-xs)] font-bold text-green-700 flex-shrink-0">Pick</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            /* ---- The product's places, each a full path ---- */
            <div>
              {overlaps.length > 0 && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-[var(--fs-sm)] font-bold text-amber-900 mb-1">Overlapping places</p>
                  {overlaps.map((o) => (
                    <div key={`${o.outer}-${o.inner}`} className="text-[var(--fs-xs)] text-amber-800">
                      <b>{byId.get(o.inner)?.name}</b> is inside <b>{byId.get(o.outer)?.name}</b> — counting both would count this product twice.
                    </div>
                  ))}
                  <button onClick={keepMostPrecise} disabled={saving}
                    className="mt-2 w-full py-2 rounded-lg bg-amber-600 text-white text-[var(--fs-xs)] font-bold active:bg-amber-700 disabled:opacity-50">
                    Keep the most precise places
                  </button>
                </div>
              )}
              {chosen.size === 0 ? (
                <p className="text-center text-gray-400 py-6 text-[var(--fs-sm)]">
                  No place picked yet — it counts under “Everything else”.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 mb-3">
                  {Array.from(chosen).filter((id) => byId.has(id)).map((id) => {
                    const path = pathOf(id);
                    const leaf = path[path.length - 1];
                    return (
                      <div key={id} className="flex items-center gap-2 rounded-xl border border-green-500 bg-green-50 px-3 py-2.5">
                        <span className="flex-1 min-w-0">
                          {path.length > 1 && (
                            <span className="block truncate text-[var(--fs-xs)] text-green-800/70">
                              {path.slice(0, -1).map((n, i) => (
                                <span key={n.id}>{i > 0 && <span className="opacity-40"> › </span>}{iconOf(n.kind)} {n.name}</span>
                              ))}
                            </span>
                          )}
                          <span className="block truncate font-bold text-green-900">{iconOf(leaf.kind)} {leaf.name}</span>
                        </span>
                        <button onClick={() => removePlace(id)} disabled={saving} aria-label={`Remove ${leaf.name}`}
                          className="w-7 h-7 rounded-full bg-white/70 text-green-800 font-bold flex items-center justify-center flex-shrink-0 active:bg-white">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setPicking([])} disabled={saving}
                className="w-full py-3 rounded-xl border-2 border-dashed border-green-300 text-green-700 text-[var(--fs-sm)] font-bold active:bg-green-50 disabled:opacity-50">
                + Add a place
              </button>
            </div>
          )}
          {!loading && canManageLocations && editMode && (
            <div className="flex flex-col gap-2 mt-3">
              <button onClick={() => setCreating({})} disabled={saving}
                className="w-full py-3 rounded-xl border-2 border-dashed border-green-300 text-green-700 text-[var(--fs-sm)] font-bold active:bg-green-50 disabled:opacity-50">
                + New top-level location
              </button>
              {/* The inline controls cover add / rename / type / delete. The full
                  manager is only needed for drag-reordering or printing labels. */}
              <button onClick={() => setManaging(true)} disabled={saving}
                className="w-full py-1.5 text-[var(--fs-xs)] font-semibold text-blue-700 active:opacity-70">
                Reorder or print labels → Manage locations
              </button>
            </div>
          )}
        </div>

        <div className="px-4 pb-6 pt-2 border-t border-gray-100">
          {error && <p className="text-[12px] text-red-600 mb-2 font-semibold">{error}</p>}
          <label className="flex items-start gap-2.5 mb-3 px-1 cursor-pointer active:opacity-80">
            <input type="checkbox" checked={applyToday} disabled={saving} onChange={(e) => setApplyToday(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0 disabled:opacity-50" />
            <span className="text-[var(--fs-xs)] text-gray-600 leading-snug">
              Also update today’s counts that haven’t been started yet
            </span>
          </label>
          <div className="text-[var(--fs-xs)] text-gray-400 mb-2 text-center">
            {chosen.size === 0 ? 'No place picked — it will count under “Everything else”' : `${chosen.size} place${chosen.size !== 1 ? 's' : ''} — counted at each, totals add up`}
          </div>
          <button onClick={save} disabled={saving || loading || !ready}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 disabled:opacity-50 active:bg-green-700">
            {saving ? 'Saving…' : ready ? 'Save home spots' : 'Loading…'}
          </button>
        </div>
      </div>

      {/* `kind` MUST be passed through to LocationForm: it defaults a missing kind
          to 'area', so omitting it silently reset a fridge/drawer's type on rename. */}
      {(creating != null || editing) && (
        <LocationForm
          initial={editing ? { id: editing.id, parent_id: editing.parent_id, name: editing.name, kind: editing.kind, description: editing.description, photo: editing.photo } : (creating ?? {})}
          baseZ={baseZ + 10}
          saving={formSaving}
          error={formError}
          onCancel={() => { setCreating(null); setEditing(null); setFormError(null); }}
          onSave={editing ? updateLocation : createLocation}
          onDelete={editing ? () => deleteLocation(editing) : undefined}
          companyId={companyId}
        />
      )}

      {/* Full Locations manager as an overlay — build an area WITH sub-spots or
          reorganise, then Back returns here (spots reloaded, selection kept).
          Reuses the canonical manager (one editor), scoped to THIS company. The
          fixed wrapper makes a stacking context so the manager's own dialogs sit
          correctly above this sheet. */}
      {managing && (
        <div className="fixed inset-0 bg-gray-50 overflow-y-auto" style={{ zIndex: baseZ + 20 }} role="dialog" aria-modal="true" aria-label="Manage locations">
          <LocationManager companyId={companyId} onBack={() => { setManaging(false); reloadFromManager(); }} />
        </div>
      )}
    </div>
  );
}
