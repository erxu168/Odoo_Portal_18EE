'use client';

/**
 * /inventory/location/[id] — a location's canonical Form View (its permanent
 * address). Part of the Universal Record Drill-Down standard: any RecordLink to
 * a location lands here. It cross-links to related records — the parent area
 * (drill up), the spots inside it (drill down), and every product that lives
 * here (drill across to the Products module) — so the record is never a dead
 * end. Editing uses the single shared LocationForm (all fields + delete),
 * gated by inventory.location.manage.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, ProductThumb } from '@/components/inventory/ui';
import RecordLink from '@/components/ui/RecordLink';
import LocationForm, { type KindRow } from '@/components/inventory/LocationForm';
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

  // Editing uses the ONE shared LocationForm (single-canonical-form rule).
  const [editing, setEditing] = useState(false);
  const [kinds, setKinds] = useState<KindRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [productsError, setProductsError] = useState(false);          // placements fetch failed (≠ genuinely empty)

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
        setLoc(l);
        // The location type dropdown needs this company's kinds.
        fetch(`/api/inventory/location-kinds?company_id=${l.company_id}`)
          .then((r) => (r.ok ? r.json() : { kinds: [] })).then((d) => setKinds(d.kinds || [])).catch(() => {});

        // Siblings/children come from the company's full list; products-here + names in parallel.
        const [allRes, placeRes] = await Promise.all([
          fetch(`/api/inventory/count-locations?company_id=${l.company_id}`).then((r) => r.ok ? r.json() : { locations: [] }).catch(() => ({ locations: [] })),
          fetch(`/api/inventory/product-locations?count_location_id=${locationId}`).then((r) => r.ok ? r.json() : { _fail: true }).catch(() => ({ _fail: true })),
        ]);
        if ((placeRes as any)._fail) setProductsError(true);
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

  async function saveLocation(patch: { name?: string; kind?: string; description?: string | null; photo?: string | null }) {
    if (!loc || saving) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await fetch('/api/inventory/count-locations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loc.id, name: patch.name, kind: patch.kind, description: patch.description ?? null, photo: patch.photo ?? null }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSaveErr(d.error || 'Could not save — try again'); return; }
      setLoc({ ...loc, name: patch.name || loc.name, kind: patch.kind || loc.kind, description: patch.description ?? null, photo: patch.photo ?? null });
      setEditing(false); setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(null), 1800);
    } catch { setSaveErr('Network error — not saved'); }
    finally { setSaving(false); }
  }

  async function deleteLocation() {
    if (!loc || saving) return;
    // Delete cascades: everything inside this location + its product placements.
    if (!window.confirm(`Delete “${loc.name}”? This also removes everything inside it and its product placements. This can’t be undone.`)) return;
    setSaving(true); setSaveErr(null);
    try {
      const res = await fetch(`/api/inventory/count-locations?id=${loc.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSaveErr(d.error || 'Could not delete'); return; }
      // Never back() — a parent delete also removes the child we may have come
      // from, so return to the Locations manager, not a now-deleted record.
      router.replace('/inventory');
    } catch { setSaveErr('Network error — not deleted'); }
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
        action={canEdit ? (
          <button onClick={() => setEditing(true)} className="text-white/90 text-[13px] font-bold active:opacity-70">Edit</button>
        ) : undefined} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loc.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={loc.photo} alt="" className="w-full max-h-56 object-cover rounded-2xl border border-gray-200 mb-4" />
        )}

        {/* Identity (view) — editing uses the shared LocationForm modal */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold text-gray-900">{loc.name}</h1>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 rounded-md px-1.5 py-0.5">{loc.kind}</span>
          </div>
          {loc.description && <p className="text-[var(--fs-sm)] text-gray-500 mt-1">{loc.description}</p>}
          {savedMsg && <span className="text-[12px] font-bold text-green-600">{savedMsg}</span>}
        </div>

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
          {productsError ? (
            <p className="text-[var(--fs-sm)] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              Couldn{'\''}t load the products here — reload to try again.
            </p>
          ) : products.length === 0 ? (
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
            Open the Locations manager (add spots, reorder) →
          </button>
        )}
      </div>

      {/* The ONE location form (same component the Locations manager uses). */}
      {editing && (
        <LocationForm
          initial={loc}
          kinds={kinds}
          onCancel={() => { setEditing(false); setSaveErr(null); }}
          onSave={saveLocation}
          onDelete={deleteLocation}
          saving={saving}
          error={saveErr}
        />
      )}
    </div>
  );
}
