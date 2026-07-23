'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import AppHeader from '@/components/ui/AppHeader';
import { DragRow } from '@/components/ui/DragRow';
import RecordLink from '@/components/ui/RecordLink';
import LocationForm, { type KindRow, fallbackLabel } from './LocationForm';
import ManageKinds from './ManageKinds';
import { useCompany } from '@/lib/company-context';
import { buildLocationTree } from '@/lib/location-tree';
import type { CountLocation } from '@/types/inventory';

// Location types are per-company, manager-editable (location_kinds table).
export default function LocationManager({ onBack }: { onBack: () => void }) {
  const { companyId } = useCompany();
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [kinds, setKinds] = useState<KindRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Partial<CountLocation> | null>(null); // null = closed
  const [assignFor, setAssignFor] = useState<CountLocation | null>(null);
  const [managingKinds, setManagingKinds] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const q = companyId ? `?company_id=${companyId}` : '';
      const [locRes, kindRes] = await Promise.all([
        fetch('/api/inventory/count-locations' + q),
        fetch('/api/inventory/location-kinds' + q),
      ]);
      if (!locRes.ok) { setLoadError(true); setLocations([]); return; }
      const d = await locRes.json();
      setLocations(d.locations || []);
      if (kindRes.ok) {
        const k = await kindRes.json();
        setKinds(k.kinds || []);
      }
    } catch {
      setLoadError(true);
    } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const kindLabel = (v: string) =>
    kinds.find((k) => k.kind.toLowerCase() === (v || '').toLowerCase())?.label || fallbackLabel(v);

  const tree = buildLocationTree(locations);

  // Fetch that surfaces a failed mutation instead of silently "succeeding".
  async function mutate(url: string, init: RequestInit): Promise<boolean> {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Something went wrong — please try again.');
        return false;
      }
      return true;
    } catch {
      alert('Network error — please try again.');
      return false;
    }
  }

  async function save(loc: Partial<CountLocation>) {
    const method = loc.id ? 'PUT' : 'POST';
    const payload = { ...loc, company_id: companyId };
    const ok = await mutate('/api/inventory/count-locations', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!ok) return;
    setEditing(null); await load();
  }
  async function remove(id: number) {
    if (!confirm('Remove this location and everything under it?')) return;
    const ok = await mutate(`/api/inventory/count-locations?id=${id}`, { method: 'DELETE' });
    if (!ok) return;
    setEditing(null); await load();
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
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <p className="text-red-700 font-semibold text-sm mb-2">Could not load locations.</p>
            <button onClick={() => load()} className="text-sm font-bold text-red-700 underline">Try again</button>
          </div>
        )}
        {!loadError && tree.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center text-gray-500">
            No locations yet. Add your first area (for example {'“'}Walk-in Fridge{'”'}).
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tree.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            {tree.map((area) => (
              <DragRow key={area.id} id={area.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {(handle) => (
                  <>
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-11 h-11 rounded-xl bg-cover bg-center bg-gray-100 flex-shrink-0"
                           style={area.photo ? { backgroundImage: `url(${area.photo})` } : undefined} />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 truncate">{area.name}</div>
                        <div className="text-xs text-gray-500">{kindLabel(area.kind)}</div>
                      </div>
                      {handle}
                      <button onClick={() => setEditing(area)} className="text-sm font-semibold text-blue-600 px-2">Edit</button>
                      <RecordLink type="location" id={area.id} label={area.name} />
                    </div>
                    <div className="border-t border-gray-100">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={area.children.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                        {area.children.map((shelf) => (
                          <DragRow key={shelf.id} id={shelf.id} className="flex items-center gap-2 px-3 py-2.5 pl-6 border-b border-gray-50 bg-white">
                            {(shelfHandle) => (
                              <>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-gray-800 text-sm truncate">{shelf.name}</div>
                                  <div className="text-[11px] text-gray-400">{kindLabel(shelf.kind)}</div>
                                </div>
                                {shelfHandle}
                                <button onClick={() => setAssignFor(shelf)} className="text-xs font-semibold text-green-700 px-1">Products</button>
                                <button onClick={() => setEditing(shelf)} className="text-xs font-semibold text-blue-600 px-1">Edit</button>
                                <RecordLink type="location" id={shelf.id} label={shelf.name} />
                              </>
                            )}
                          </DragRow>
                        ))}
                      </SortableContext>
                      </DndContext>
                      <button onClick={() => setEditing({ parent_id: area.id, kind: kinds.find((k) => k.kind === 'zone')?.kind || kinds[0]?.kind || 'zone' })}
                              className="w-full text-left px-6 py-2.5 text-sm font-semibold text-green-700 active:bg-gray-50">
                        + Add a shelf / spot
                      </button>
                    </div>
                  </>
                )}
              </DragRow>
            ))}
          </SortableContext>
        </DndContext>
        <button onClick={() => setEditing({ parent_id: null, kind: kinds.find((k) => k.kind === 'area')?.kind || kinds[0]?.kind || 'area' })}
                className="w-full py-4 rounded-2xl bg-green-600 text-white font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
          + Add an area
        </button>
      </div>

      {editing && (
        <LocationForm
          initial={editing}
          kinds={kinds}
          onManageKinds={() => setManagingKinds(true)}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id as number) : undefined}
        />
      )}
      {assignFor && <AssignProducts location={assignFor} onClose={() => setAssignFor(null)} />}
      {managingKinds && (
        <ManageKinds
          companyId={companyId}
          kinds={kinds}
          locations={locations}
          onChanged={async () => {
            try {
              const res = await fetch('/api/inventory/location-kinds' + (companyId ? `?company_id=${companyId}` : ''));
              if (res.ok) { const k = await res.json(); setKinds(k.kinds || []); }
            } catch { /* keep the current list */ }
          }}
          onClose={() => setManagingKinds(false)}
        />
      )}
    </div>
  );
}


function AssignProducts({ location, onClose }: { location: CountLocation; onClose: () => void }) {
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [chosen, setChosen] = useState<number[]>([]); // ordered
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const [prodR, placeR] = await Promise.all([
          fetch('/api/inventory/products?include_pos=1'),
          fetch(`/api/inventory/product-locations?count_location_id=${location.id}`),
        ]);
        if (!prodR.ok || !placeR.ok) throw new Error('load failed');
        const prodRes = await prodR.json();
        const placeRes = await placeR.json();
        setProducts(prodRes.products || []);
        setChosen(((placeRes.placements || []) as { odoo_product_id: number; shelf_sort: number }[])
          .sort((a, b) => a.shelf_sort - b.shelf_sort).map((p) => p.odoo_product_id));
      } catch {
        alert('Could not load products — please try again.');
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.id]);
  function toggle(id: number) { setChosen((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]); }
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/product-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count_location_id: location.id, items: chosen.map((id, i) => ({ odoo_product_id: id, shelf_sort: (i + 1) * 10 })) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not save — please try again.');
        return;
      }
      onClose();
    } catch {
      alert('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  }
  const list = products.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col">
      <AppHeader title={location.name} subtitle="Pick products, in shelf order" showBack onBack={onClose} />
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…"
             className="mx-4 my-3 border-2 border-gray-200 rounded-xl px-3 py-2.5 bg-gray-50" />
      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {loading ? <div className="text-center text-gray-400 py-8">Loading…</div> : list.map((p) => {
          const idx = chosen.indexOf(p.id);
          return (
            <button key={p.id} onClick={() => toggle(p.id)}
                    className={`w-full flex items-center gap-3 py-3 border-b border-gray-100 text-left ${idx > -1 ? 'opacity-100' : 'opacity-70'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${idx > -1 ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {idx > -1 ? idx + 1 : '+'}
              </div>
              <span className="flex-1 truncate">{p.name}</span>
            </button>
          );
        })}
      </div>
      <div className="p-4 border-t border-gray-100">
        <button onClick={save} disabled={saving} className="w-full py-4 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">
          {saving ? 'Saving…' : `Save ${chosen.length} product${chosen.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
}
