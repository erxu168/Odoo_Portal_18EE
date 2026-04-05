'use client';

import React from 'react';
import { StatusDot } from './ui';
import type { ComponentAvailability } from '@/types/manufacturing';

// ── View-mode props ──

export interface BomIngredientListViewProps {
  components: ComponentAvailability[];
  expandedSubBoms: Set<number>;
  toggleSubBom: (productId: number) => void;
  fmt: (n: number) => string;
}

/** Read-only ingredient list grouped by category with sub-BOM expansion */
export function BomIngredientListView({
  components,
  expandedSubBoms,
  toggleSubBom,
  fmt,
}: BomIngredientListViewProps) {
  const cats = Array.from(new Set(components.map((c: any) => c.category || 'Other')));
  return (
    <>
      <div className="px-5 pt-3 pb-2">
        <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase">Ingredients</p>
      </div>

      <div className="px-4 pb-8 flex flex-col gap-1.5">
        {cats.map(cat => {
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
        })}
      </div>
    </>
  );
}

// ── Edit-mode props ──

export interface EditLine {
  line_id: number;
  product_id: number;
  product_name: string;
  product_qty: number;
  uom: string;
  uom_id: number;
}

export interface BomIngredientListEditProps {
  editLines: EditLine[];
  updateLineQty: (lineId: number, newQty: string) => void;
  removeLine: (lineId: number) => void;
  showAddSearch: boolean;
  setShowAddSearch: (v: boolean) => void;
  searchQuery: string;
  handleSearchChange: (q: string) => void;
  searching: boolean;
  searchResults: any[];
  addIngredient: (product: any) => void;
  setSearchQuery: (q: string) => void;
  setSearchResults: (r: any[]) => void;
}

/** Editable ingredient list with inline qty editing, removal, and product search/add */
export function BomIngredientListEdit({
  editLines,
  updateLineQty,
  removeLine,
  showAddSearch,
  setShowAddSearch,
  searchQuery,
  handleSearchChange,
  searching,
  searchResults,
  addIngredient,
  setSearchQuery,
  setSearchResults,
}: BomIngredientListEditProps) {
  return (
    <>
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

      {/* Add ingredient search */}
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
    </>
  );
}
