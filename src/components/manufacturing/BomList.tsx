'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { StatusDot } from './ui';
import type { Bom } from '@/types/manufacturing';

interface BomListProps {
  onSelect: (bom: Bom) => void;
}

export default function BomList({ onSelect }: BomListProps) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => {
    fetchBoms();
  }, []);

  async function fetchBoms() {
    setLoading(true);
    try {
      const res = await fetch('/api/boms');
      const data = await res.json();
      setBoms(data.boms || []);
    } catch (err) {
      console.error('Failed to fetch BOMs:', err);
    } finally {
      setLoading(false);
    }
  }

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set(boms.map((b) => b.category || 'Uncategorized'));
    return ['All', ...Array.from(cats).sort()];
  }, [boms]);

  // Filter BOMs
  const filtered = useMemo(() => {
    return boms.filter((b) => {
      const matchSearch =
        !search ||
        b.product_tmpl_id[1].toLowerCase().includes(search.toLowerCase());
      const matchCategory =
        activeCategory === 'All' || b.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [boms, search, activeCategory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading recipes...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-medium text-gray-900 dark:text-white">
          Recipes
        </h1>
        <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
          {filtered.length} active BOMs
        </p>
      </div>

      {/* Search */}
      <div className="mx-5 mt-3">
        <input
          type="text"
          placeholder="Search recipes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-2 px-5 py-3 overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
              activeCategory === cat
                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* BOM Cards */}
      <div className="px-4 pb-6 flex flex-col gap-2">
        {filtered.map((bom) => (
          <button
            key={bom.id}
            onClick={() => onSelect(bom)}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3.5 flex justify-between items-center text-left w-full active:bg-gray-50 dark:active:bg-gray-800 transition-colors"
          >
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-gray-900 dark:text-white truncate">
                <StatusDot status={bom.availability_status || 'ok'} />
                {bom.product_tmpl_id[1]}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {bom.category} &middot; {bom.component_count} components
              </div>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <div className="text-right">
                <div className="text-[13px] font-medium text-gray-600 dark:text-gray-300">
                  {new Intl.NumberFormat('de-DE').format(bom.product_qty)}
                  {bom.product_uom_id[1]}
                </div>
                <div className="text-[11px] text-gray-400">per batch</div>
              </div>
              <span className="text-gray-300 dark:text-gray-600 text-lg">
                ›
              </span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No recipes found
          </div>
        )}
      </div>
    </div>
  );
}
