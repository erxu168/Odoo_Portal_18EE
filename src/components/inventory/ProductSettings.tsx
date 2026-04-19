'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';

interface ProductSettingsProps {
  onBack: () => void;
}

export default function ProductSettings({ onBack }: ProductSettingsProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [flags, setFlags] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);

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
        const map: Record<number, boolean> = {};
        (flagRes.flags || []).forEach((f: any) => { map[f.odoo_product_id] = !!f.requires_photo; });
        setFlags(map);
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

  async function toggle(productId: number) {
    const next = !flags[productId];
    setFlags(prev => ({ ...prev, [productId]: next }));
    setSaving(productId);
    try {
      const res = await fetch(`/api/inventory/product-flags/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_photo: next }),
      });
      if (!res.ok) {
        setFlags(prev => ({ ...prev, [productId]: !next }));
      }
    } catch {
      setFlags(prev => ({ ...prev, [productId]: !next }));
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

      <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {filtered.length === 0 ? (
          <EmptyState title="No products" body="Try a different search" />
        ) : (
          <div className="flex flex-col">
            {filtered.map((p: any) => {
              const on = !!flags[p.id];
              const busy = saving === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => !busy && toggle(p.id)}
                  disabled={busy}
                  className="flex items-center justify-between gap-3 py-3.5 border-b border-gray-100 text-left active:bg-gray-50 disabled:opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{p.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                      {p.categ_id?.[1] || ''} {on && <span className="text-[#F5800A] font-semibold ml-1">- Photo required</span>}
                    </div>
                  </div>
                  <div className={`relative w-11 h-[26px] rounded-full transition-colors ${on ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
                    <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
