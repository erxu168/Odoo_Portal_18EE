'use client';
import React, { useEffect, useState, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import FilePicker from '@/components/ui/FilePicker';
import { useCompany } from '@/lib/company-context';
import { buildLocationTree, reorder } from '@/lib/location-tree';
import type { CountLocation } from '@/types/inventory';

const KINDS = [
  { v: 'area', l: 'Area' }, { v: 'fridge', l: 'Fridge' }, { v: 'freezer', l: 'Freezer' },
  { v: 'dry', l: 'Dry store' }, { v: 'zone', l: 'Zone' }, { v: 'bar', l: 'Bar' },
];
const kindLabel = (v: string) => KINDS.find((k) => k.v === v)?.l || v;

function downscale(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900; let w = img.width, h = img.height;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function LocationManager({ onBack }: { onBack: () => void }) {
  const { companyId } = useCompany();
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Partial<CountLocation> | null>(null); // null = closed
  const [assignFor, setAssignFor] = useState<CountLocation | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const url = '/api/inventory/count-locations' + (companyId ? `?company_id=${companyId}` : '');
      const res = await fetch(url);
      if (!res.ok) { setLoadError(true); setLocations([]); return; }
      const d = await res.json();
      setLocations(d.locations || []);
    } catch {
      setLoadError(true);
    } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

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
  async function move(node: CountLocation, dir: -1 | 1) {
    const siblings = locations.filter((l) => l.parent_id === node.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const orderedIds = reorder(siblings.map((s) => s.id), node.id, dir);
    if (orderedIds.join() === siblings.map((s) => s.id).join()) return; // edge no-op
    for (let i = 0; i < orderedIds.length; i++) {
      const ok = await mutate('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderedIds[i], sort_order: (i + 1) * 10 }),
      });
      if (!ok) break;
    }
    await load();
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
        {tree.map((area) => (
          <div key={area.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <div className="w-11 h-11 rounded-xl bg-cover bg-center bg-gray-100 flex-shrink-0"
                   style={area.photo ? { backgroundImage: `url(${area.photo})` } : undefined} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900 truncate">{area.name}</div>
                <div className="text-xs text-gray-500">{kindLabel(area.kind)}</div>
              </div>
              <button onClick={() => move(area, -1)} aria-label="Move up" className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200">↑</button>
              <button onClick={() => move(area, 1)} aria-label="Move down" className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200">↓</button>
              <button onClick={() => setEditing(area)} className="text-sm font-semibold text-blue-600 px-2">Edit</button>
            </div>
            <div className="border-t border-gray-100">
              {area.children.map((shelf) => (
                <div key={shelf.id} className="flex items-center gap-2 px-3 py-2.5 pl-6 border-b border-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-800 text-sm truncate">{shelf.name}</div>
                    <div className="text-[11px] text-gray-400">{kindLabel(shelf.kind)}</div>
                  </div>
                  <button onClick={() => move(shelf, -1)} aria-label="Move up" className="w-7 h-7 rounded-lg bg-gray-100 text-sm">↑</button>
                  <button onClick={() => move(shelf, 1)} aria-label="Move down" className="w-7 h-7 rounded-lg bg-gray-100 text-sm">↓</button>
                  <button onClick={() => setAssignFor(shelf)} className="text-xs font-semibold text-green-700 px-1">Products</button>
                  <button onClick={() => setEditing(shelf)} className="text-xs font-semibold text-blue-600 px-1">Edit</button>
                </div>
              ))}
              <button onClick={() => setEditing({ parent_id: area.id, kind: 'zone' })}
                      className="w-full text-left px-6 py-2.5 text-sm font-semibold text-green-700 active:bg-gray-50">
                + Add a shelf / spot
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => setEditing({ parent_id: null, kind: 'area' })}
                className="w-full py-4 rounded-2xl bg-green-600 text-white font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
          + Add an area
        </button>
      </div>

      {editing && (
        <LocationForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id as number) : undefined}
        />
      )}
      {assignFor && <AssignProducts location={assignFor} onClose={() => setAssignFor(null)} />}
    </div>
  );
}

function LocationForm({ initial, onCancel, onSave, onDelete }: {
  initial: Partial<CountLocation>;
  onCancel: () => void;
  onSave: (loc: Partial<CountLocation>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name || '');
  const [kind, setKind] = useState(initial.kind || 'area');
  const [description, setDescription] = useState(initial.description || '');
  const [photo, setPhoto] = useState<string | null>(initial.photo || null);
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-3">{initial.id ? 'Edit location' : 'New location'}</h3>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Walk-in Fridge"
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50">
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
        </select>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Where to stand (optional)</label>
        <input value={description || ''} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Back-left wall, top two shelves"
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Photo (optional)</label>
        {photo ? (
          <div className="relative mb-3">
            <img src={photo} alt="" className="w-full rounded-xl border border-gray-200" />
            <button onClick={() => setPhoto(null)} aria-label="Remove photo"
                    className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8">×</button>
          </div>
        ) : (
          <FilePicker accept="image/*" onFile={async (f: File) => setPhoto(await downscale(f))}
                      label="Add a photo"
                      className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold mb-3" />
        )}
        <div className="flex gap-3 mt-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold">Cancel</button>
          <button onClick={() => name.trim() && onSave({ ...initial, name: name.trim(), kind, description, photo })}
                  disabled={!name.trim()}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">Save</button>
        </div>
        {onDelete && <button onClick={onDelete} className="w-full mt-3 py-2.5 text-red-600 font-semibold text-sm">Remove this location</button>}
      </div>
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
