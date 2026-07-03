'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';
import { suggestCrateSizeFromName } from '@/lib/crate-units';

interface ProductSettingsProps {
  onBack: () => void;
}

export default function ProductSettings({ onBack }: ProductSettingsProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [crateSizes, setCrateSizes] = useState<Record<number, string>>({});   // per-product input strings ('' = no crate)
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [prodRes, flagRes] = await Promise.all([
          fetch('/api/inventory/products?limit=500').then(r => r.json()),
          fetch('/api/inventory/product-flags').then(r => r.json()),
        ]);
        const prods = (prodRes.products || []).filter((p: any) => p.active !== false);
        setProducts(prods);
        const photoMap: Record<number, boolean> = {};
        const crateMap: Record<number, string> = {};
        (flagRes.flags || []).forEach((f: any) => {
          photoMap[f.odoo_product_id] = !!f.requires_photo;
          if (f.units_per_crate != null) crateMap[f.odoo_product_id] = String(f.units_per_crate);
        });
        setFlags(photoMap);
        setCrateSizes(crateMap);
      } catch (err) {
        console.error('Failed to load product settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  async function togglePhoto(productId: number) {
    const next = !flags[productId];
    setFlags(prev => ({ ...prev, [productId]: next }));
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_photo: next }),
      });
      if (!res.ok) setFlags(prev => ({ ...prev, [productId]: !next }));
    } catch {
      setFlags(prev => ({ ...prev, [productId]: !next }));
    }
  }

  // Commit a crate size (blur / suggest). Empty or 0 clears it (count in base units).
  async function commitCrateSize(productId: number, raw: string) {
    const trimmed = (raw || '').trim();
    const size = trimmed === '' ? null : Number(trimmed);
    if (size !== null && (!Number.isFinite(size) || size < 0)) {
      // invalid → revert display to empty
      setCrateSizes(prev => ({ ...prev, [productId]: '' }));
      return;
    }
    setSaving(productId);
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units_per_crate: size }),
      });
      if (res.ok) {
        setSavedId(productId);
        setTimeout(() => setSavedId(prev => (prev === productId ? null : prev)), 1400);
      }
    } catch (err) {
      console.error('Failed to save crate size:', err);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Product settings</h1>
      </div>

      <div className="px-4 pb-1 flex items-start gap-2 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C2410C" strokeWidth="2" className="flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
        <span>Set a crate size so staff can count that product in crates + loose units. Leave blank to count in single units.</span>
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p: any) => {
              const on = !!flags[p.id];
              const uom = p.uom_id?.[1] || 'Units';
              const crateStr = crateSizes[p.id] ?? '';
              const suggestion = suggestCrateSizeFromName(p.name);
              return (
                <div key={p.id} className="py-3.5 border-b border-gray-100 [content-visibility:auto] [contain-intrinsic-size:auto_84px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                      <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{p.categ_id?.[1] || ''}</div>
                    </div>
                    <button
                      onClick={() => togglePhoto(p.id)}
                      aria-label="Photo required"
                      className="flex items-center gap-2 flex-shrink-0 active:opacity-80"
                    >
                      <span className="text-[10px] font-bold uppercase text-gray-400">Photo</span>
                      <div className={`relative w-11 h-[26px] rounded-full transition-colors ${on ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
                        <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                      </div>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                    <span className="text-[var(--fs-xs)] font-semibold text-gray-500">Crate size</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={crateStr}
                        onChange={(e) => setCrateSizes(prev => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        onBlur={(e) => commitCrateSize(p.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`Units per crate for ${p.name}`}
                        className="w-14 h-9 border border-gray-300 rounded-lg text-center font-mono text-[var(--fs-base)] font-semibold text-gray-900 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/15"
                      />
                      <span className="text-[var(--fs-xs)] text-gray-400">{uom}/crate</span>
                    </div>
                    {suggestion !== null && crateStr === '' && (
                      <button
                        onClick={() => { setCrateSizes(prev => ({ ...prev, [p.id]: String(suggestion) })); commitCrateSize(p.id, String(suggestion)); }}
                        className="text-[11px] font-bold text-blue-800 bg-blue-50 rounded-md px-2 py-1 active:bg-blue-100"
                      >
                        Suggest: {suggestion}
                      </button>
                    )}
                    {saving === p.id && <span className="text-[11px] text-gray-400">Saving…</span>}
                    {savedId === p.id && saving !== p.id && (
                      <span className="text-[11px] text-green-600 font-semibold inline-flex items-center gap-1">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>Saved
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
