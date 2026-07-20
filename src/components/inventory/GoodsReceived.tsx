'use client';

/**
 * Goods received ("purchased-in") — portal-native, no Odoo stock.
 * Search or scan a product, enter the delivered quantity (pack + loose when the
 * product has a pack size, else a plain amount), optional note + delivery photo,
 * and it's logged to /api/inventory/receipts. A running list of recent receipts
 * shows below. This is the "received" input to the usage model
 * (consumption = opening + received − closing).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '@/lib/company-context';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';
import { SearchBar, Spinner, EmptyState, ProductThumb, Stepper } from './ui';
import NumpadModal from './NumpadModal';
import { crateTotal, hasCrate, splitFromTotal, formatSplit, baseIsMeasure } from '@/lib/crate-units';

// Read a picked image (camera or file) and downscale it on-device to keep the
// stored data URL small — same approach as Product Settings / Locations.
function downscale(file: File, max = 1024, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no canvas')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function todayISO(receivedAt: string): string {
  return String(receivedAt).slice(0, 10);
}

export default function GoodsReceived() {
  const { companyId, loading: companyLoading } = useCompany();
  const [products, setProducts] = useState<any[]>([]);
  const [crateSizes, setCrateSizes] = useState<Record<number, number>>({});
  const [crateLabels, setCrateLabels] = useState<Record<number, string>>({});
  const [productImageIds, setProductImageIds] = useState<Set<number>>(new Set());
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entry, setEntry] = useState<any | null>(null);   // product being logged
  const [toast, setToast] = useState<string | null>(null);

  const productName = useCallback(
    (id: number) => products.find((p) => p.id === id)?.name || `#${id}`,
    [products],
  );

  const loadReceipts = useCallback(async () => {
    if (!companyId) return;
    try {
      const d = await fetch(`/api/inventory/receipts?company_id=${companyId}`).then((r) => r.json());
      setReceipts(d.receipts || []);
    } catch { /* keep current */ }
  }, [companyId]);

  const fetchData = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [prodRes, flagRes, imgRes] = await Promise.all([
        fetch(`/api/inventory/products?company_id=${companyId}&relevant=1`).then((r) => r.json()),
        fetch('/api/inventory/product-flags').then((r) => r.json()),
        fetch('/api/inventory/product-images').then((r) => r.ok ? r.json() : { with_images: [] }).catch(() => ({ with_images: [] })),
      ]);
      setProducts((prodRes.products || []).filter((p: any) => p.active !== false));
      const sizes: Record<number, number> = {};
      const labels: Record<number, string> = {};
      (flagRes.flags || []).forEach((f: any) => {
        if (f.units_per_crate != null && Number(f.units_per_crate) > 0) sizes[f.odoo_product_id] = Number(f.units_per_crate);
        if (f.pack_label) labels[f.odoo_product_id] = f.pack_label;
      });
      setCrateSizes(sizes);
      setCrateLabels(labels);
      setProductImageIds(new Set<number>(imgRes.with_images || []));
      await loadReceipts();
    } catch (err) {
      console.error('Failed to load goods-received data:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, loadReceipts]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  // Hardware (HID) barcode scanner — match against loaded products and open the
  // log sheet. Unknown barcodes just toast (receiving is for known products).
  useHardwareScanner({
    enabled: !entry,
    onScan: (barcode) => {
      const p = products.find((x) => x.barcode && String(x.barcode) === barcode);
      if (p) { setEntry(p); try { navigator.vibrate?.(50); } catch { /* ignore */ } }
      else showToast('Barcode not found in this restaurant’s products');
    },
  });

  async function deleteReceipt(id: number) {
    if (!confirm('Remove this receipt?')) return;
    try {
      const res = await fetch(`/api/inventory/receipts?id=${id}`, { method: 'DELETE' });
      if (res.ok) { setReceipts((prev) => prev.filter((r) => r.id !== id)); }
      else showToast('Could not remove — try again');
    } catch { showToast('Network error — try again'); }
  }

  const filtered = React.useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p) =>
      p.name.toLowerCase().includes(q)
      || (p.default_code && String(p.default_code).toLowerCase().includes(q)));
  }, [products, search]);

  if (companyLoading || loading) return <Spinner />;
  if (!companyId) {
    return <EmptyState icon="🏪" title="Pick a restaurant" body="Choose a restaurant in the top bar to log goods received." />;
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <SearchBar value={search} onChange={setSearch} placeholder="Search or scan a product…" />

      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {/* Recent receipts */}
        {receipts.length > 0 && !search && (
          <div className="mb-4">
            <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">Recently received</p>
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {receipts.slice(0, 30).map((r, idx) => {
                const uom = r.uom || 'Units';
                const packLabel = crateLabels[r.odoo_product_id] ?? (baseIsMeasure(uom) ? 'piece' : 'crate');
                const qtyText = r.units_per_crate
                  ? formatSplit(Number(r.crate_qty) || 0, Number(r.loose_qty) || 0, uom, packLabel)
                  : `${r.qty_base} ${uom}`;
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${idx < Math.min(receipts.length, 30) - 1 ? 'border-b border-gray-100' : ''}`}>
                    <ProductThumb productId={r.odoo_product_id} has={productImageIds.has(r.odoo_product_id)} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{productName(r.odoo_product_id)}</div>
                      <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                        {todayISO(r.received_at)}{r.received_by_name ? ` · ${r.received_by_name}` : ''}{r.note ? ` · ${r.note}` : ''}
                      </div>
                    </div>
                    <span className="font-mono text-[var(--fs-base)] font-bold text-green-700 flex-shrink-0">+{qtyText}</span>
                    <button onClick={() => deleteReceipt(r.id)} aria-label="Remove receipt"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 active:bg-red-50 active:text-red-500 flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Product picker */}
        <p className="text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mt-2 mb-2">
          {search ? 'Results' : 'Log a delivery'}
        </p>
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search." />
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {filtered.slice(0, 100).map((p, idx) => {
              const uom = p.uom_id?.[1] || 'Units';
              return (
                <button key={p.id} onClick={() => setEntry(p)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-gray-50 ${idx < Math.min(filtered.length, 100) - 1 ? 'border-b border-gray-100' : ''}`}>
                  <ProductThumb productId={p.id} has={productImageIds.has(p.id)} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                      {uom}{crateSizes[p.id] ? ` · 1 ${crateLabels[p.id] || 'pack'} = ${crateSizes[p.id]}` : ''}{p.default_code ? ` · #${p.default_code}` : ''}
                    </div>
                  </div>
                  <span className="text-green-700 text-[var(--fs-sm)] font-bold flex-shrink-0">Receive {'→'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {entry && (
        <LogReceiptSheet
          product={entry}
          hasImage={productImageIds.has(entry.id)}
          companyId={companyId}
          unitsPerCrate={crateSizes[entry.id] || 0}
          packLabel={crateLabels[entry.id] ?? (baseIsMeasure(entry.uom_id?.[1] || 'Units') ? 'piece' : 'crate')}
          onClose={() => setEntry(null)}
          onSaved={async () => { setEntry(null); showToast('Delivery logged'); await loadReceipts(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] bg-gray-900 text-white text-[var(--fs-sm)] font-semibold px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Bottom sheet: enter a delivered quantity (+ note/photo) and log the receipt. */
function LogReceiptSheet({ product, hasImage, companyId, unitsPerCrate, packLabel, onClose, onSaved }: {
  product: any;
  hasImage: boolean;
  companyId: number;
  unitsPerCrate: number;
  packLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const uom = product.uom_id?.[1] || 'Units';
  const isPack = hasCrate(unitsPerCrate);
  const measure = baseIsMeasure(uom);
  const [crates, setCrates] = useState(0);
  const [loose, setLoose] = useState(0);
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [pad, setPad] = useState<null | 'qty' | 'crates' | 'loose'>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const base = isPack ? crateTotal(crates, loose, unitsPerCrate) : qty;
  const canSave = base > 0 && !saving;

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setPhoto(await downscale(file)); } catch { /* ignore */ }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body: any = {
        product_id: product.id,
        company_id: companyId,
        count_location_id: 0,
        uom,
        note: note.trim() || undefined,
        photo: photo || undefined,
      };
      if (isPack) { body.crate_qty = crates; body.loose_qty = loose; body.units_per_crate = unitsPerCrate; }
      else { body.counted_qty = qty; }
      const res = await fetch('/api/inventory/receipts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not log the delivery — try again.');
        return;
      }
      onSaved();
    } catch { alert('Network error — try again.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-900">Log a delivery</h3>
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Cancel</button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <ProductThumb productId={product.id} has={hasImage} size={48} />
          <div className="min-w-0">
            <div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">{product.name}</div>
            <div className="text-[var(--fs-xs)] text-gray-400">base {uom}{isPack ? ` · 1 ${packLabel} ${measure ? '≈' : '='} ${unitsPerCrate}` : ''}</div>
          </div>
        </div>

        {isPack ? (
          <div className="flex gap-3 mb-2">
            <div className="flex-1">
              <label className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">{packLabel}s</label>
              <Stepper value={crates} uom={packLabel} onMinus={() => setCrates((n) => Math.max(0, n - 1))} onPlus={() => setCrates((n) => n + 1)} onTap={() => setPad('crates')} />
            </div>
            {!measure && (
              <div className="flex-1">
                <label className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">Loose {uom}</label>
                <Stepper value={loose} uom={uom} onMinus={() => setLoose((n) => Math.max(0, n - 1))} onPlus={() => setLoose((n) => n + 1)} onTap={() => setPad('loose')} />
              </div>
            )}
          </div>
        ) : (
          <div className="mb-2">
            <label className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">Quantity</label>
            <Stepper value={qty} uom={uom} onMinus={() => setQty((n) => Math.max(0, n - 1))} onPlus={() => setQty((n) => n + 1)} onTap={() => setPad('qty')} />
          </div>
        )}
        <div className="text-[var(--fs-sm)] text-gray-500 mb-4 font-mono">= {base} {uom} received</div>

        <label className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier, invoice no." maxLength={500}
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-4 bg-gray-50 text-[var(--fs-base)]" />

        <label className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1">Delivery photo (optional)</label>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
        {photo ? (
          <div className="relative mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" className="w-full rounded-xl border border-gray-200" />
            <button onClick={() => setPhoto(null)} aria-label="Remove photo" className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8">{'×'}</button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} className="w-full py-3.5 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold mb-4 active:bg-gray-50">
            {'📷'} Add a photo
          </button>
        )}

        <button onClick={save} disabled={!canSave}
          className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-xl)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-40 disabled:shadow-none">
          {saving ? 'Saving…' : `Log ${base} ${uom} received`}
        </button>
      </div>

      <NumpadModal
        open={pad !== null}
        productName={product.name}
        category={pad === 'crates' ? `${packLabel}s` : pad === 'loose' ? `Loose ${uom}` : 'Quantity'}
        uom={pad === 'crates' ? packLabel : uom}
        initialValue={pad === 'crates' ? crates : pad === 'loose' ? loose : qty}
        showSystemQty={false}
        systemQty={null}
        locationName=""
        onSave={(v) => {
          const val = v ?? 0;
          if (pad === 'crates') setCrates(val);
          else if (pad === 'loose') setLoose(val);
          else setQty(val);
          setPad(null);
        }}
        onClose={() => setPad(null)}
      />
    </div>
  );
}
