'use client';

/**
 * DrinksEditor — Inventory module screen (manager+).
 *
 * Search a What a Jerk drink and directly edit its details: name, unit,
 * price, tax and till section (POS category). Writes straight to Odoo via
 * /api/pos-drinks (action: 'update'). Sibling screen to DrinksScanner.
 */
import React, { useEffect, useRef, useState } from 'react';
import { SearchBar, Spinner, EmptyState } from './ui';

type Drink = { id: number; name: string; barcode: string | null; price: number };
type Option = { id: number; name: string };
type UomOption = Option & { category: string };
type Options = { categories: Option[]; taxes: Array<Option & { amount: number }>; uoms: UomOption[] };
type Form = { name: string; price: string; uom_id: number | null; tax_id: number | null; pos_categ_id: number | null };
type Phase = 'list' | 'loading' | 'edit' | 'saving';

const eur = (n: number) => `€${(n ?? 0).toFixed(2)}`;

export default function DrinksEditor({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('list');
  const [search, setSearch] = useState('');
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [options, setOptions] = useState<Options | null>(null);
  const [editing, setEditing] = useState<Drink | null>(null);
  const [form, setForm] = useState<Form>({ name: '', price: '', uom_id: null, tax_id: null, pos_categ_id: null });
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const searchSeq = useRef(0);

  function flash(kind: 'ok' | 'err', text: string) {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 3500);
  }

  // Load dropdown choices once (till sections, taxes, units).
  useEffect(() => {
    fetch('/api/pos-drinks?options=1').then((r) => r.json())
      .then((d) => { if (!d.error) setOptions(d); })
      .catch(() => {});
    runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(term: string) {
    const seq = ++searchSeq.current;
    setListLoading(true);
    try {
      const res = await fetch(`/api/pos-drinks?q=${encodeURIComponent(term)}`).then((r) => r.json());
      if (seq === searchSeq.current) setDrinks(res.results ?? []);
    } catch {
      /* keep previous list */
    } finally {
      if (seq === searchSeq.current) setListLoading(false);
    }
  }

  function onSearchChange(v: string) { setSearch(v); runSearch(v); }

  async function openDrink(d: Drink) {
    setEditing(d);
    setPhase('loading');
    try {
      const res = await fetch(`/api/pos-drinks?detail=${d.id}`).then((r) => r.json());
      if (res.error || !res.product) throw new Error(res.error || 'Could not load this drink');
      const p = res.product;
      setForm({
        name: p.name ?? d.name,
        price: (p.price ?? 0).toString(),
        uom_id: p.uom_id ?? null,
        tax_id: p.tax_id ?? null,
        pos_categ_id: p.pos_categ_id ?? null,
      });
      setPhase('edit');
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : 'Could not load this drink');
      setEditing(null);
      setPhase('list');
    }
  }

  function backToList() { setEditing(null); setPhase('list'); }

  async function save() {
    if (!editing) return;
    const price = parseFloat(form.price.replace(',', '.'));
    if (!form.name.trim()) { flash('err', 'Enter a drink name'); return; }
    if (!Number.isFinite(price) || price < 0) { flash('err', 'Enter a valid price'); return; }
    setPhase('saving');
    try {
      const res = await fetch('/api/pos-drinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          product_id: editing.id,
          name: form.name.trim(),
          list_price: price,
          uom_id: form.uom_id,
          tax_id: form.tax_id,
          pos_categ_id: form.pos_categ_id,
        }),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || 'Could not save');
      flash('ok', `Saved → ${res.product.name}`);
      await runSearch(search);
      backToList();
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : 'Could not save');
      setPhase('edit');
    }
  }

  const Toast = toast ? (
    <div className={`mx-4 mt-4 rounded-xl px-4 py-3 text-[var(--fs-sm)] font-medium ${
      toast.kind === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>
      {toast.text}
    </div>
  ) : null;

  // ---- Edit form ----
  if (editing && (phase === 'edit' || phase === 'saving' || phase === 'loading')) {
    const saving = phase === 'saving';
    return (
      <div className="flex flex-col min-h-0 flex-1">
        <div className="px-4 pt-3 pb-1">
          <button onClick={backToList} className="flex items-center gap-1 text-green-700 text-[var(--fs-sm)] font-semibold active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            All drinks
          </button>
          <h1 className="text-[var(--fs-xl)] font-bold text-gray-900 mt-1 truncate">{editing.name}</h1>
        </div>

        {Toast}

        {phase === 'loading' ? <Spinner /> : (
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-28">
            <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm space-y-4">
              {/* Name */}
              <label className="block">
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-base)] outline-none focus:border-green-500"
                />
              </label>

              {/* Price */}
              <label className="block">
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">Price</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-gray-500 text-[var(--fs-lg)]">€</span>
                  <input
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/[^0-9.,]/g, '') }))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-base)] font-mono outline-none focus:border-green-500"
                  />
                </div>
              </label>

              {/* Unit */}
              <label className="block">
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">Unit</span>
                <select
                  value={form.uom_id ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, uom_id: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-base)] bg-white outline-none focus:border-green-500"
                >
                  <option value="">— choose —</option>
                  {(options?.uoms ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>

              {/* Tax */}
              <label className="block">
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">Tax</span>
                <select
                  value={form.tax_id ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-base)] bg-white outline-none focus:border-green-500"
                >
                  <option value="">— choose —</option>
                  {(options?.taxes ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              {/* Till section (POS category) */}
              <label className="block">
                <span className="text-[var(--fs-sm)] font-semibold text-gray-700">Till section</span>
                <select
                  value={form.pos_categ_id ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, pos_categ_id: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[var(--fs-base)] bg-white outline-none focus:border-green-500"
                >
                  <option value="">— choose —</option>
                  {(options?.categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="text-[var(--fs-xs)] text-gray-400 mt-1 block">Which tab this drink shows under at the till.</span>
              </label>
            </div>

            <button
              onClick={save}
              disabled={saving}
              className="mt-5 w-full rounded-xl bg-[#F5800A] text-white py-3.5 text-[var(--fs-lg)] font-bold active:bg-orange-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Drink list ----
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Edit drinks</h1>
      </div>

      {Toast}

      <SearchBar value={search} onChange={onSearchChange} placeholder="Search drinks (e.g. Pepsi, Ting)..." />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {listLoading ? <Spinner /> : drinks.length === 0 ? (
          <EmptyState title="No drinks found" body="Try a different search." />
        ) : (
          <div className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 shadow-sm">
            {drinks.map((d) => (
              <button
                key={d.id}
                onClick={() => openDrink(d)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left active:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{d.name}</div>
                  <div className="text-[var(--fs-xs)] text-gray-400">
                    {eur(d.price)}{d.barcode ? ` · barcode ${d.barcode}` : ' · no barcode'}
                  </div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
