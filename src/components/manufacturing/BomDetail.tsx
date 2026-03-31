'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { StatusDot } from './ui';
import type { ComponentAvailability } from '@/types/manufacturing';

interface BomDetailProps {
  bomId: number;
  onBack: () => void;
  onCreateMo: (bomId: number) => void;
}

interface EditLine {
  line_id: number;
  product_id: number;
  product_name: string;
  product_qty: number;
  uom: string;
  uom_id: number;
}

export default function BomDetail({ bomId, onBack, onCreateMo }: BomDetailProps) {
  const [bom, setBom] = useState<any>(null);
  const [components, setComponents] = useState<ComponentAvailability[]>([]);
  const [canMakeQty, setCanMakeQty] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubBoms, setExpandedSubBoms] = useState<Set<number>>(new Set());

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editBomQty, setEditBomQty] = useState('');
  const [removedLineIds, setRemovedLineIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add ingredient
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BOM line IDs (fetched separately for editing)
  const [rawLines, setRawLines] = useState<any[]>([]);

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBomDetail() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boms/${bomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBom(data.bom);
      setComponents(data.components || []);
      setCanMakeQty(data.can_make_qty || 0);
      setRawLines(data.bom?.bom_line_ids || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load recipe details');
    } finally {
      setLoading(false);
    }
  }

  function startEditing() {
    // Build edit lines from components + raw line IDs
    // We need to fetch the actual line IDs — they're in bom.bom_line_ids
    fetchEditLines();
  }

  async function fetchEditLines() {
    try {
      // Fetch actual BOM line records with their IDs
      const res = await fetch(`/api/boms/${bomId}`);
      const data = await res.json();
      if (!data.bom) return;

      const lineIds = data.bom.bom_line_ids || [];
      if (!lineIds.length) {
        setEditLines([]);
        setEditBomQty(String(data.bom.product_qty));
        setEditing(true);
        return;
      }

      // Fetch line details from Odoo via a simple proxy
      const linesRes = await fetch(`/api/boms/${bomId}?include_lines=1`);
      const linesData = await linesRes.json();

      // Map components to edit lines using position matching
      const lines: EditLine[] = (linesData.components || data.components || []).map((c: any, i: number) => ({
        line_id: lineIds[i] || 0,
        product_id: c.product_id,
        product_name: c.product_name,
        product_qty: c.required_qty,
        uom: c.uom,
        uom_id: 0, // will be filled on save if needed
      }));

      setEditLines(lines);
      setEditBomQty(String(data.bom.product_qty));
      setRemovedLineIds([]);
      setEditing(true);
    } catch (_e) {
      console.error('Failed to load edit lines');
    }
  }

  function cancelEditing() {
    setEditing(false);
    setEditLines([]);
    setRemovedLineIds([]);
    setSaveError(null);
    setShowAddSearch(false);
  }

  function updateLineQty(lineId: number, newQty: string) {
    setEditLines(prev => prev.map(l =>
      l.line_id === lineId ? { ...l, product_qty: parseFloat(newQty) || 0 } : l
    ));
  }

  function removeLine(lineId: number) {
    if (lineId > 0) {
      setRemovedLineIds(prev => [...prev, lineId]);
    }
    setEditLines(prev => prev.filter(l => l.line_id !== lineId));
  }

  // Search products for adding
  function handleSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=15`);
        const data = await res.json();
        setSearchResults(data.products || []);
      } catch (_e) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addIngredient(product: any) {
    // Check if already in list
    if (editLines.some(l => l.product_id === product.id)) return;
    setEditLines(prev => [...prev, {
      line_id: -(Date.now()), // negative = new line
      product_id: product.id,
      product_name: product.name,
      product_qty: 1,
      uom: product.uom_name,
      uom_id: product.uom_id,
    }]);
    setShowAddSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body: any = {};

      // Update BOM output qty if changed
      const newBomQty = parseFloat(editBomQty);
      if (newBomQty > 0 && newBomQty !== bom.product_qty) {
        body.product_qty = newBomQty;
      }

      // Update existing lines
      const updates = editLines
        .filter(l => l.line_id > 0)
        .map(l => ({ line_id: l.line_id, product_qty: l.product_qty }));
      if (updates.length) body.update_lines = updates;

      // Add new lines
      const adds = editLines
        .filter(l => l.line_id < 0)
        .map(l => ({ product_id: l.product_id, product_qty: l.product_qty, product_uom_id: l.uom_id }));
      if (adds.length) body.add_lines = adds;

      // Remove lines
      if (removedLineIds.length) body.remove_lines = removedLineIds;

      const res = await fetch(`/api/boms/${bomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');

      setEditing(false);
      await fetchBomDetail();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function toggleSubBom(productId: number) {
    setExpandedSubBoms((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load recipe</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5">{error || 'Recipe not found'}</p>
          <button onClick={fetchBomDetail} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">Retry</button>
        </div>
      </div>
    );
  }

  const productName = bom.product_tmpl_id[1];
  const uom = bom.product_uom_id[1];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title={productName}
        subtitle={`${fmt(bom.product_qty)} ${uom} per batch`}
        showBack
        onBack={onBack}
        action={
          !editing ? (
            <button
              onClick={startEditing}
              className="px-3 py-1.5 rounded-lg bg-white/15 border border-white/20 text-white text-[var(--fs-xs)] font-bold active:bg-white/25"
            >
              Edit
            </button>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">INGREDIENTS</div>
            <div className="text-lg font-bold text-green-600 mt-0.5 font-mono">{components.length}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">CAN MAKE</div>
            <div className="text-lg font-bold text-green-500 mt-0.5 font-mono">{fmt(canMakeQty)} {uom}</div>
          </div>
        </div>
      </div>

      {/* Edit mode */}
      {editing ? (
        <div className="px-4 pb-8">
          {/* BOM output qty */}
          <div className="mb-4">
            <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">Output quantity ({uom})</label>
            <input
              type="number"
              inputMode="decimal"
              value={editBomQty}
              onChange={e => setEditBomQty(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-xxl)] font-bold text-gray-900 outline-none focus:border-green-600"
            />
          </div>

          {/* Editable ingredient list */}
          <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
            Ingredients ({editLines.length})
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {editLines.map(line => (
              <div key={line.line_id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{line.product_name}</div>
                  <div className="text-[var(--fs-xs)] text-gray-400">{line.uom}</div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={line.product_qty || ''}
                  onChange={e => updateLineQty(line.line_id, e.target.value)}
                  className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[var(--fs-md)] font-bold font-mono text-right text-gray-900 outline-none focus:border-green-600"
                />
                <button
                  onClick={() => removeLine(line.line_id)}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center active:bg-red-100 flex-shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-500">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add ingredient */}
          {showAddSearch ? (
            <div className="bg-white border border-green-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  autoFocus
                  className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600"
                />
                <button onClick={() => { setShowAddSearch(false); setSearchQuery(''); setSearchResults([]); }}
                  className="text-[var(--fs-xs)] font-semibold text-gray-500 px-2">Cancel</button>
              </div>
              {searching && <div className="text-center py-3"><div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" /></div>}
              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.map(p => {
                    const alreadyAdded = editLines.some(l => l.product_id === p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => !alreadyAdded && addIngredient(p)}
                        disabled={alreadyAdded}
                        className="w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-0 active:bg-green-50 disabled:opacity-40"
                      >
                        <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{p.name}</div>
                        <div className="text-[var(--fs-xs)] text-gray-400">{p.uom_name} {alreadyAdded ? '(already added)' : ''}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div className="text-[var(--fs-xs)] text-gray-400 text-center py-3">No products found</div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAddSearch(true)}
              className="w-full py-3 rounded-xl border-[1.5px] border-dashed border-gray-300 text-[var(--fs-sm)] font-semibold text-gray-500 flex items-center justify-center gap-2 active:bg-gray-50 mb-4"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add ingredient
            </button>
          )}

          {saveError && (
            <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-xs)]">{saveError}</div>
          )}

          {/* Save / Cancel buttons */}
          <div className="flex gap-2">
            <button onClick={cancelEditing} disabled={saving}
              className="flex-1 py-4 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-[var(--fs-sm)] active:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Read-only ingredient list */}
          <div className="px-5 pt-1 pb-2">
            <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase">Ingredients</p>
          </div>

          <div className="px-4 pb-8 flex flex-col gap-1.5">
            {(() => {
              const cats = Array.from(new Set(components.map((c: any) => c.category || 'Other')));
              return cats.map(cat => {
                const catComps = components.filter((c: any) => (c.category || 'Other') === cat);
                return (
                  <div key={cat} className="mb-4">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-2 flex justify-between">
                      <span>{cat}</span>
                      <span className="font-mono text-gray-300">{catComps.length}</span>
                    </div>
                    {catComps.map((comp) => (
                      <React.Fragment key={comp.product_id}>
                        <button
                          onClick={() => comp.is_sub_bom && toggleSubBom(comp.product_id)}
                          className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center text-left w-full mb-1.5 ${
                            comp.is_sub_bom ? 'border-green-200 active:scale-[0.98] transition-transform' : 'border-gray-200'
                          }`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <StatusDot status={comp.status} />
                            <div className="min-w-0">
                              <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                                {comp.product_name}
                                {comp.is_sub_bom && <span className="ml-2 text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-green-50 text-green-800 font-semibold">Sub-recipe</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-3">
                            <div className="text-[var(--fs-md)] font-bold text-gray-900 tabular-nums font-mono">
                              {fmt(comp.required_qty)} {comp.uom}
                            </div>
                            <div className={`text-[var(--fs-xs)] mt-0.5 ${
                              comp.status === 'ok' ? 'text-green-600' : comp.status === 'low' ? 'text-amber-600' : 'text-red-600'
                            }`}>
                              {fmt(comp.on_hand_qty)} {comp.uom} on hand
                            </div>
                          </div>
                        </button>

                        {comp.is_sub_bom && expandedSubBoms.has(comp.product_id) && comp.sub_bom_lines && (
                          <div className="ml-5 border-l-2 border-green-200 mb-1.5">
                            <div className="ml-3 bg-white border border-green-200 rounded-xl overflow-hidden">
                              <div className="divide-y divide-gray-100">
                                {comp.sub_bom_lines.map((sub) => (
                                  <div key={sub.product_id} className="px-3.5 py-2.5 flex justify-between items-center">
                                    <span className="text-[var(--fs-sm)] text-gray-900 flex items-center gap-1.5">
                                      <StatusDot status={sub.status} />{sub.product_name}
                                    </span>
                                    <span className="text-[var(--fs-sm)] font-bold text-gray-700 font-mono">
                                      {fmt(sub.required_qty)} {sub.uom}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                );
              });
            })()}
          </div>

          {/* Bottom actions */}
          <div className="px-4 pb-8">
            <button onClick={() => onCreateMo(bomId)}
              className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform">
              Create manufacturing order
            </button>
          </div>
        </>
      )}
    </div>
  );
}
