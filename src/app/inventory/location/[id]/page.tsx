'use client';

/**
 * /inventory/location/[id] — a location's canonical Form View (its permanent
 * address). Part of the Universal Record Drill-Down standard: any RecordLink to
 * a location lands here. It cross-links to related records — the parent area
 * (drill up), the spots inside it (drill down), and every product that lives
 * here (drill across to the Products module) — so the record is never a dead
 * end. Permission-aware: name/notes are editable only with location.manage.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, ProductThumb } from '@/components/inventory/ui';
import RecordLink from '@/components/ui/RecordLink';
import { RECORD_EDIT_CAP } from '@/lib/record-links';
import { allowedActionKeysForRole, type Role } from '@/lib/permissions';

interface Loc { id: number; parent_id: number | null; name: string; kind: string; description: string | null; photo: string | null; company_id: number; }

export default function LocationRecordPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const locationId = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;

  const [loc, setLoc] = useState<Loc | null>(null);
  const [parent, setParent] = useState<Loc | null>(null);
  const [children, setChildren] = useState<Loc[]>([]);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [imageIds, setImageIds] = useState<Set<number>>(new Set());
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline edit (managers): the descriptive fields. Structural moves (reparent,
  // reorder, delete, type) stay in the Locations manager.
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const back = () => (window.history.length > 1 ? router.back() : router.push('/inventory'));

  useEffect(() => {
    if (!Number.isInteger(locationId) || locationId <= 0) { setError('Invalid location'); setLoading(false); return; }
    (async () => {
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
        const me = d?.user;
        const caps: string[] = Array.isArray(me?.capabilities) ? me.capabilities
          : me?.role ? allowedActionKeysForRole(me.role as Role, {}) : [];
        setCanEdit(caps.includes(RECORD_EDIT_CAP.location));
      }).catch(() => {});

      try {
        const one = await fetch(`/api/inventory/count-locations?id=${locationId}`);
        if (!one.ok) throw new Error(one.status === 404 ? 'Location not found' : 'Could not load the location');
        const l: Loc = (await one.json()).location;
        setLoc(l); setName(l.name); setDesc(l.description || '');

        // Siblings/children come from the company's full list; products-here + names in parallel.
        const [allRes, placeRes] = await Promise.all([
          fetch(`/api/inventory/count-locations?company_id=${l.company_id}`).then((r) => r.ok ? r.json() : { locations: [] }),
          fetch(`/api/inventory/product-locations?count_location_id=${locationId}`).then((r) => r.ok ? r.json() : { placements: [] }),
        ]);
        const all: Loc[] = allRes.locations || [];
        setParent(l.parent_id != null ? all.find((x) => x.id === l.parent_id) || null : null);
        setChildren(all.filter((x) => x.parent_id === l.id));

        const pids: number[] = (placeRes.placements || []).map((p: any) => p.odoo_product_id);
        if (pids.length > 0) {
          const [prodRes, imgRes] = await Promise.all([
            fetch(`/api/inventory/products?ids=${pids.join(',')}&limit=1000`).then((r) => r.ok ? r.json() : { products: [] }),
            fetch('/api/inventory/product-images').then((r) => r.ok ? r.json() : { with_images: [] }).catch(() => ({ with_images: [] })),
          ]);
          const byId = new Map<number, string>((prodRes.products || []).map((p: any) => [p.id, p.name]));
          setProducts(pids.map((id) => ({ id, name: byId.get(id) || `#${id}` })));
          setImageIds(new Set<number>(imgRes.with_images || []));
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load the location');
      } finally {
        setLoading(false);
      }
    })();
  }, [locationId]);

  async function saveEdits() {
    if (!loc || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loc.id, name: name.trim(), description: desc.trim() || null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSavedMsg(d.error || 'Could not save'); return; }
      setLoc({ ...loc, name: name.trim(), description: desc.trim() || null });
      setEditing(false); setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(null), 1800);
    } catch { setSavedMsg('Network error — not saved'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>;

  if (error || !loc) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">{error || 'Location not found'}</p>
        <button onClick={back} className="mt-3 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Go back</button>
      </div>
    );
  }

  const sectionLabel = 'text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Location" subtitle={loc.name} showBack onBack={back}
        action={canEdit && !editing ? (
          <button onClick={() => setEditing(true)} className="text-white/90 text-[13px] font-bold active:opacity-70">Edit</button>
        ) : undefined} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loc.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={loc.photo} alt="" className="w-full max-h-56 object-cover rounded-2xl border border-gray-200 mb-4" />
        )}

        {/* Identity — view or inline edit */}
        {editing ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <label className={sectionLabel}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 mb-3 outline-none focus:border-green-500" />
            <label className={sectionLabel}>Notes (where to stand / what{'\''}s here)</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={500}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-green-500 resize-none" />
            <div className="flex gap-2 mt-3">
              <button onClick={saveEdits} disabled={saving || name.trim().length < 1}
                className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setName(loc.name); setDesc(loc.description || ''); }}
                className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-bold">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-bold text-gray-900">{loc.name}</h1>
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">{loc.kind}</span>
            </div>
            {loc.description && <p className="text-[var(--fs-sm)] text-gray-500 mt-1">{loc.description}</p>}
            {savedMsg && <span className="text-[12px] font-bold text-green-600">{savedMsg}</span>}
          </div>
        )}

        {/* Parent — drill up */}
        {parent && (
          <div className="mb-4">
            <div className={sectionLabel}>Inside area</div>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-[var(--fs-base)] font-semibold text-gray-900 flex-1 truncate">📍 {parent.name}</span>
              <RecordLink type="location" id={parent.id} label={parent.name} />
            </div>
          </div>
        )}

        {/* Child spots — drill down */}
        {children.length > 0 && (
          <div className="mb-4">
            <div className={sectionLabel}>Spots inside ({children.length})</div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {children.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 last:border-b-0">
                  <span className="text-[var(--fs-base)] font-semibold text-gray-800 flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] font-bold uppercase text-gray-400">{c.kind}</span>
                  <RecordLink type="location" id={c.id} label={c.name} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Products stored here — drill across to the Products module */}
        <div className="mb-8">
          <div className={sectionLabel}>Products stored here ({products.length})</div>
          {products.length === 0 ? (
            <p className="text-[var(--fs-sm)] text-gray-400 bg-white border border-gray-200 rounded-xl px-4 py-3">
              No products list this as a home spot yet.
            </p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-b-0">
                  <ProductThumb productId={p.id} has={imageIds.has(p.id)} size={36} />
                  <span className="text-[var(--fs-base)] font-semibold text-gray-900 flex-1 truncate">{p.name}</span>
                  <RecordLink type="product" id={p.id} label={p.name} />
                </div>
              ))}
            </div>
          )}
        </div>

        {canEdit && (
          <button onClick={() => router.push('/inventory')}
            className="w-full py-3 rounded-xl bg-white border border-gray-200 text-gray-600 text-[var(--fs-sm)] font-semibold active:bg-gray-50 mb-8">
            Open the Locations manager (add spots, reorder, delete) →
          </button>
        )}
      </div>
    </div>
  );
}
