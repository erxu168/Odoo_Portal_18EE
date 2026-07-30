'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { announceChange } from '@/lib/record-events';
import { isExpanded, toggleExpanded, expandAll, collapseAll, expandedCount } from '@/lib/tree-expansion';
import { useRecordList } from '@/lib/useRecordChanges';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import AppHeader from '@/components/ui/AppHeader';
import { DragRow } from '@/components/ui/DragRow';
import RecordLink from '@/components/ui/RecordLink';
import LocationForm from './LocationForm';
import LocationLabels from './LocationLabels';
import { useCompany } from '@/lib/company-context';
import { buildLocationTree, type LocationNode as LocationTreeNode } from '@/lib/location-tree';
import { typeIcon, typeLabel, suggestedChildTypes, TOP_LEVEL_TYPE_KEYS } from '@/lib/location-types';
import { useLocationTypes } from '@/lib/use-location-types';
import type { CountLocation } from '@/types/inventory';

/**
 * One node of the location hierarchy, rendered RECURSIVELY to any depth:
 * the node's own row, then its children (each its own drag-reorderable group),
 * then a "+ Add inside" button. Depth 0 is a card; deeper levels are lighter,
 * indented rows. Drag-reorder stays within each sibling group at every level.
 */
function LocationNode({ node, depth, sensors, onDragEnd, onEdit, iconOf = typeIcon, scope, expandTick, onToggle }: {
  node: LocationTreeNode<CountLocation>;
  depth: number;
  /** Expansion scope — per screen, so a picker sheet opens independently. */
  scope: string;
  /** Bumped by the parent on any expand/collapse, to force this subtree to re-read. */
  expandTick: number;
  onToggle: (id: number) => void;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (e: DragEndEvent) => void;
  onEdit: (loc: Partial<CountLocation>) => void;
  /** Resolves a type's emoji incl. custom types; defaults to the built-in icon. */
  iconOf?: (kind: string | null | undefined) => string;
}) {
  const isRoot = depth === 0;
  // COLLAPSIBLE. Ethan: rooms give the overview, shelves appear when you open the
  // room. Closed by default at every level — a deep map buried its own rooms.
  const hasChildren = node.children.length > 0;
  // expandTick is read so this re-renders when the shared store changes; the
  // store is module-level and deliberately outside React (see lib/tree-expansion).
  void expandTick;
  const isOpen = hasChildren ? isExpanded(scope, node.id) : true;
  /** Everything below this node, so a closed row can say what it is hiding. */
  const insideCount = React.useMemo(() => {
    let n = 0;
    const walk = (kids: LocationTreeNode[]) => { for (const k of kids) { n++; walk(k.children); } };
    walk(node.children);
    return n;
  }, [node.children]);
  const rowPad = 12 + depth * 16;          // indent the row itself with depth
  const childPad = 12 + (depth + 1) * 16;  // "+ Add inside" aligns with children
  return (
    <DragRow
      id={node.id}
      className={isRoot ? 'bg-white border border-gray-200 rounded-2xl overflow-hidden' : 'bg-white'}
    >
      {(handle) => (
        <>
          <div
            className={isRoot ? 'flex items-center gap-3 p-3' : 'flex items-center gap-2 px-3 py-2.5 border-b border-gray-50'}
            style={{ paddingLeft: rowPad }}
          >
            {node.photo ? (
              <div
                className={isRoot
                  ? 'w-11 h-11 rounded-xl bg-cover bg-center bg-gray-100 flex-shrink-0'
                  : 'w-9 h-9 rounded-lg bg-cover bg-center bg-gray-100 flex-shrink-0'}
                style={{ backgroundImage: `url(${node.photo})` }}
              />
            ) : (
              <div
                className={isRoot
                  ? 'w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-xl'
                  : 'w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 text-base'}
                aria-hidden="true"
              >
                {iconOf(node.kind)}
              </div>
            )}
            {/* The whole name area toggles, not just the arrow — a 12px chevron
                is not a tablet target. Rows with nothing inside get a spacer so
                every name still lines up. */}
            {hasChildren ? (
              <button
                onClick={() => onToggle(node.id)}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
                className="flex-shrink-0 w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-gray-400 active:bg-gray-100"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round"
                  className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ) : (
              <span className="flex-shrink-0 w-8" aria-hidden="true" />
            )}
            <div className="flex-1 min-w-0">
              <div className={isRoot ? 'font-bold text-gray-900 truncate' : 'font-semibold text-gray-800 text-sm truncate'}>
                {node.name}
                {/* Collapsing SUMMARISES; it must not simply hide. A silent
                    closed row makes people open every one again to check. */}
                {hasChildren && !isOpen && (
                  <span className="ml-2 text-[11px] font-semibold text-gray-400">
                    {insideCount} inside
                  </span>
                )}
              </div>
              {/* Named slots just show their note (if any), not a type. */}
              {node.description && (
                <div className={isRoot ? 'text-xs text-gray-500 truncate' : 'text-[11px] text-gray-400 truncate'}>
                  {node.description}
                </div>
              )}
            </div>
            {handle}
            <button
              onClick={() => onEdit(node)}
              className={isRoot ? 'text-sm font-semibold text-blue-600 px-2' : 'text-xs font-semibold text-blue-600 px-1'}
            >
              Edit
            </button>
            <RecordLink type="location" id={node.id} label={node.name} />
          </div>
          {isOpen && (
          <div className={isRoot ? 'border-t border-gray-100' : undefined}>
            {/* Drag-reorder within this node's own children (same pattern at every depth). */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={node.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {node.children.map((child) => (
                  <LocationNode key={child.id} node={child} depth={depth + 1} sensors={sensors} onDragEnd={onDragEnd} onEdit={onEdit} iconOf={iconOf} scope={scope} expandTick={expandTick} onToggle={onToggle} />
                ))}
              </SortableContext>
            </DndContext>
            {/* Each add-row is explicitly labelled with ITS parent, so it's
                unambiguous whether a "+ Shelf/Drawer/…" adds a layer INSIDE this
                unit vs inside its parent — the two rows otherwise stack with only
                a small indent between them and read as one. */}
            <div className="py-2.5 pr-3" style={{ paddingLeft: childPad }}>
              <div className="text-[11px] font-semibold text-gray-400 mb-1.5">
                <span className="text-green-600" aria-hidden="true">{'↳'}</span> Add inside {node.name}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {suggestedChildTypes(node.kind).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => onEdit({ parent_id: node.id, kind: t.key })}
                    className="rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 active:bg-green-100"
                  >
                    + {t.label}
                  </button>
                ))}
                <button
                  onClick={() => onEdit({ parent_id: node.id })}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-gray-400 active:text-gray-600"
                >
                  + Something else{'…'}
                </button>
              </div>
            </div>
          </div>
          )}
        </>
      )}
    </DragRow>
  );
}

// Location types = built-in base (src/lib/location-types.ts) + a company's CUSTOM
// types (managed via "Edit types" → ManageTypesSheet). Icons resolve through the
// useLocationTypes hook so custom emojis show in the tree too.
export default function LocationManager({ onBack, companyId: companyIdProp }: { onBack: () => void; companyId?: number }) {
  // When opened as an overlay from the home-spots picker (SpotSheet), the caller
  // passes the picker's company so locations land under the SAME company the
  // product/list belongs to — not whatever the global switcher happens to be.
  const { companyId: activeCompanyId } = useCompany();
  const companyId = companyIdProp ?? activeCompanyId;
  // Type icons incl. this company's CUSTOM types (built-ins + custom).
  const { iconOf } = useLocationTypes(companyId);
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Partial<CountLocation> | null>(null); // null = closed
  const [printing, setPrinting] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const q = companyId ? `?company_id=${companyId}` : '';
      const locRes = await fetch('/api/inventory/count-locations' + q);
      if (!locRes.ok) { setLoadError(true); setLocations([]); return; }
      const d = await locRes.json();
      setLocations(d.locations || []);
    } catch {
      setLoadError(true);
    } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  // Hear about locations deleted ANYWHERE — most importantly on the location's
  // own page, which is where the "it's still there until I refresh" complaint
  // came from. Patches the array in place, so nothing re-mounts and the scroll
  // position survives.
  useRecordList('location', setLocations, (l) => l.id);

  // COLLAPSE STATE. Held in a module-level store, not in this component and not
  // in any browser storage — see lib/tree-expansion for why. The tick is what
  // makes React notice a store that lives outside it.
  const scope = `locations:${companyId ?? 'all'}`;
  const [expandTick, setExpandTick] = useState(0);
  const toggle = useCallback((id: number) => {
    toggleExpanded(scope, id);
    setExpandTick((t) => t + 1);
  }, [scope]);
  const allOpen = expandedCount(scope) > 0;

  const tree = buildLocationTree(locations);

  // Fetch that surfaces a failed mutation instead of silently "succeeding".
  /** Returns the response body on success, null on failure — callers need
   *  removed_ids to announce a cascade. */
  async function mutate(url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Something went wrong — please try again.');
        return null;
      }
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      alert('Network error — please try again.');
      return null;
    }
  }

  async function save(loc: Partial<CountLocation>) {
    const method = loc.id ? 'PUT' : 'POST';
    // Guardrail: warn on a duplicate name in the SAME parent ("which Shelf?").
    if (!loc.id) {
      const nm = (loc.name || '').trim();
      const dup = locations.some((l) => (l.parent_id ?? null) === (loc.parent_id ?? null) && l.name.trim().toLowerCase() === nm.toLowerCase());
      if (dup && !confirm(`You already have a “${nm}” here. Add another anyway?`)) return;
    }
    const payload = { ...loc, company_id: companyId };
    const ok = await mutate('/api/inventory/count-locations', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!ok) return;
    setEditing(null); await load();
  }
  // Quick start — a few common typed areas so the manager isn't a blank page
  // (rename/delete/extend freely). Solves the blank-canvas problem the location
  // research flagged as the real reason free-naming felt hard.
  async function quickStart() {
    if (seeding) return;
    setSeeding(true);
    const starters = [
      { name: 'Kitchen', kind: 'area' },
      { name: 'Dry store', kind: 'dryshelf' },
      { name: 'Walk-in cooler', kind: 'walkin' },
      { name: 'Freezer', kind: 'freezer' },
      { name: 'Bar', kind: 'area' },
    ];
    for (const s of starters) {
      const ok = await mutate('/api/inventory/count-locations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, parent_id: null, company_id: companyId }),
      });
      if (!ok) break;
    }
    setSeeding(false);
    await load();
  }
  async function remove(id: number) {
    if (!confirm('Remove this location and everything under it?')) return;
    const body = await mutate(`/api/inventory/count-locations?id=${id}`, { method: 'DELETE' });
    if (!body) return;
    setEditing(null);
    // Dropped IN PLACE rather than reloaded. `await load()` worked, but it
    // re-rendered the whole tree from the top — which on a long list threw away
    // the scroll position, so removing one shelf sent you back to the start.
    const removed: number[] = Array.isArray(body.removed_ids) ? (body.removed_ids as number[]) : [id];
    const gone = new Set(removed);
    setLocations((prev) => prev.filter((l) => !gone.has(l.id)));
    // ...and tell everything else, so the location's own page and any picker
    // holding this tree drop it too.
    announceChange({ kind: 'location', verb: 'deleted', id, alsoAffected: removed.filter((x) => x !== id) });
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // Persist a new sibling order: optimistic local update, then write each sort_order.
  async function persistOrder(orderedIds: number[]) {
    setLocations((prev) => prev.map((l) => {
      const i = orderedIds.indexOf(l.id);
      return i === -1 ? l : { ...l, sort_order: (i + 1) * 10 };
    }));
    for (let i = 0; i < orderedIds.length; i++) {
      const ok = await mutate('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderedIds[i], sort_order: (i + 1) * 10 }),
      });
      if (!ok) { await load(); return; } // revert to server truth on failure
    }
  }

  // Drag-to-reorder within a sibling group (areas among areas; shelves within their area).
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);
    const activeNode = locations.find((l) => l.id === activeId);
    const overNode = locations.find((l) => l.id === overId);
    if (!activeNode || !overNode || activeNode.parent_id !== overNode.parent_id) return;
    const siblingIds = locations
      .filter((l) => l.parent_id === activeNode.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => s.id);
    const from = siblingIds.indexOf(activeId);
    const to = siblingIds.indexOf(overId);
    if (from === -1 || to === -1) return;
    persistOrder(arrayMove(siblingIds, from, to));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Locations" subtitle="Set up where staff count" showBack onBack={onBack} />
        <div className="p-8 text-center text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Locations" subtitle="Set up where staff count" showBack onBack={onBack} />
      <div className="px-4 py-4 space-y-3">
        {/* Building the map wants everything open; using it wants everything
            closed. Same screen, two jobs — so both are one tap away. Text rather
            than a button: it is a view control, not an action on the data. */}
        {tree.length > 0 && (
          <div className="flex justify-end -mb-1">
            <button
              onClick={() => {
                if (allOpen) collapseAll(scope);
                else expandAll(scope, locations.map((l) => l.id));
                setExpandTick((t) => t + 1);
              }}
              className="text-[var(--fs-sm)] font-semibold text-blue-600 px-2 py-1 active:opacity-70"
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <p className="text-red-700 font-semibold text-sm mb-2">Could not load locations.</p>
            <button onClick={() => load()} className="text-sm font-bold text-red-700 underline">Try again</button>
          </div>
        )}
        {!loadError && tree.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-gray-500">
            <p className="mb-3">No locations yet. Start from a few common areas, then rename or add your own.</p>
            <button onClick={quickStart} disabled={seeding}
              className="px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700 disabled:opacity-50">
              {seeding ? 'Setting up…' : 'Quick start (Kitchen, Bar, Walk-in…)'}
            </button>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tree.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            {tree.map((area) => (
              <LocationNode
                key={area.id}
                node={area}
                depth={0}
                sensors={sensors}
                onDragEnd={handleDragEnd}
                onEdit={setEditing}
                iconOf={iconOf}
                scope={scope}
                expandTick={expandTick}
                onToggle={toggle}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div className="flex flex-wrap gap-2">
          {TOP_LEVEL_TYPE_KEYS.map((key, i) => (
            <button key={key} onClick={() => setEditing({ parent_id: null, kind: key })}
                    className={i === 0
                      ? 'py-3 px-5 rounded-2xl bg-green-600 text-white font-bold shadow-lg shadow-green-600/30 active:bg-green-700'
                      : 'py-3 px-4 rounded-2xl border-2 border-gray-200 text-gray-700 font-bold active:bg-gray-50'}>
              + {typeLabel(key)}
            </button>
          ))}
          <button onClick={() => setEditing({ parent_id: null })}
                  className="py-3 px-4 rounded-2xl text-gray-400 font-bold active:text-gray-600">
            + Something else{'…'}
          </button>
        </div>
        {tree.length > 0 && (
          <button onClick={() => setPrinting(true)}
                  className="w-full py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-bold active:bg-gray-50">
            🖨 Print location labels
          </button>
        )}
      </div>

      {editing && (
        <LocationForm
          initial={editing}
          companyId={companyId ?? undefined}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id as number) : undefined}
        />
      )}
      {printing && companyId && <LocationLabels companyId={companyId} onClose={() => setPrinting(false)} />}
    </div>
  );
}
