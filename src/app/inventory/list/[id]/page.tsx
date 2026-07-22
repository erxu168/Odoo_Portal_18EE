'use client';

/**
 * /inventory/list/[id] — a counting list's canonical Form View. Part of the
 * Universal Record Drill-Down standard: any RecordLink to a list lands here.
 * The payoff is the product roster — each product drills into the Products
 * module, and from there to its locations — so a list is a hub, never a dead
 * end. Permission-aware: managers get an "edit" path; others view.
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, ProductThumb, StatusBadge } from '@/components/inventory/ui';
import RecordLink from '@/components/ui/RecordLink';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ListRecordPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const listId = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;

  const [tmpl, setTmpl] = useState<any | null>(null);
  const [products, setProducts] = useState<{ id: number; name: string }[]>([]);
  const [productsError, setProductsError] = useState(false);
  const [imageIds, setImageIds] = useState<Set<number>>(new Set());
  const [locName, setLocName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const back = () => (window.history.length > 1 ? router.back() : router.push('/inventory'));

  useEffect(() => {
    if (!Number.isInteger(listId) || listId <= 0) { setError('Invalid list'); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/inventory/templates/${listId}`);
        if (!res.ok) throw new Error(res.status === 404 ? 'List not found' : 'Could not load the list');
        const t = (await res.json()).template;
        setTmpl(t);

        const pids: number[] = Array.isArray(t.product_ids) ? t.product_ids : [];
        const [prodRes, imgRes, locRes] = await Promise.all([
          pids.length > 0
            ? fetch(`/api/inventory/products?ids=${pids.join(',')}&limit=1000`).then((r) => r.ok ? r.json() : { _fail: true }).catch(() => ({ _fail: true }))
            : Promise.resolve({ products: [] }),
          fetch('/api/inventory/product-images').then((r) => r.ok ? r.json() : { with_images: [] }).catch(() => ({ with_images: [] })),
          fetch('/api/inventory/locations').then((r) => r.ok ? r.json() : { locations: [] }).catch(() => ({ locations: [] })),
        ]);
        if ((prodRes as any)._fail) setProductsError(true);
        else {
          const byId = new Map<number, string>(((prodRes as any).products || []).map((p: any) => [p.id, p.name]));
          setProducts(pids.map((id) => ({ id, name: byId.get(id) || `#${id}` })));
        }
        setImageIds(new Set<number>((imgRes as any).with_images || []));
        const loc = ((locRes as any).locations || []).find((l: any) => l.id === t.location_id);
        setLocName(loc ? (loc.complete_name || loc.name) : null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Could not load the list');
      } finally {
        setLoading(false);
      }
    })();
  }, [listId]);

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><Spinner /></div>;

  if (error || !tmpl) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">{error || 'List not found'}</p>
        <button onClick={back} className="mt-3 px-5 py-2.5 rounded-xl bg-green-600 text-white font-bold active:bg-green-700">Go back</button>
      </div>
    );
  }

  const days: number[] = Array.isArray(tmpl.schedule_days) ? tmpl.schedule_days : [];
  const schedule = tmpl.frequency === 'daily' ? 'Every day'
    : tmpl.frequency === 'weekly' ? (days.length ? `Weekly · ${days.map((d) => WD[d]).join(', ')}` : 'Weekly')
    : tmpl.frequency === 'adhoc' ? (tmpl.adhoc_date ? `One-off · ${tmpl.adhoc_date}` : 'One-off') : tmpl.frequency;
  const assignee = tmpl.assign_type
    ? `${tmpl.assign_type}: ${tmpl.assign_label || tmpl.assign_id || '—'}`
    : 'Anyone on shift';
  const sectionLabel = 'text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Counting list" subtitle={tmpl.name} showBack onBack={back} />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-[22px] font-bold text-gray-900">{tmpl.name}</h1>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${tmpl.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {tmpl.active ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* At-a-glance */}
        <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 mb-4 text-[var(--fs-sm)]">
          <Row k="Schedule" v={schedule} />
          <Row k="Counts against" v={locName || '—'} />
          <Row k="Assigned to" v={assignee} />
        </div>

        {/* Product roster — the drill-down hub */}
        <div className="mb-8">
          <div className={sectionLabel}>Products on this list ({products.length})</div>
          {productsError ? (
            <p className="text-[var(--fs-sm)] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              Couldn{'\''}t load the products — reload to try again.
            </p>
          ) : products.length === 0 ? (
            <p className="text-[var(--fs-sm)] text-gray-400 bg-white border border-gray-200 rounded-xl px-4 py-3">
              No products on this list yet.
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

      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900 font-semibold text-right truncate">{v}</span>
    </div>
  );
}
