'use client';

import React, { useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';

interface Guide {
  id: number;
  name: string;
  description: string;
  lineCount: number;
  supplier: {
    id: number;
    name: string;
    phone: string;
    email: string;
    minOrderValue: number;
  } | null;
}

interface Props {
  onSelect: (guideId: number, supplierId: number) => void;
  onHome: () => void;
}

/**
 * GuideList — Order Guides screen
 *
 * Shows one card per supplier (= one purchase list per supplier).
 * Each card shows: supplier name, product count, min order, contact buttons.
 * Search bar filters by supplier name.
 */
export default function GuideList({ onSelect }: Props) {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/purchase/guides')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setGuides(data.guides || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? guides.filter(
        (g) =>
          g.name.toLowerCase().includes(search.toLowerCase()) ||
          g.supplier?.name.toLowerCase().includes(search.toLowerCase())
      )
    : guides;

  return (
    <>
      {/* Header */}
      <div className={ds.topbar}>
        <div>
          <div className={ds.topbarTitle}>Order Guides</div>
          <div className={ds.topbarSub}>One guide per supplier</div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <input
          className={ds.input}
          placeholder="Search suppliers or products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      <div className={ds.scrollArea}>
        {loading && (
          <div className="px-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`${ds.skeleton} h-32`} />
            ))}
          </div>
        )}

        {error && (
          <div className={ds.emptyState}>
            <div className={ds.emptyIcon}>⚠️</div>
            <div className={ds.emptyTitle}>Failed to load guides</div>
            <div className={ds.emptyBody}>{error}</div>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className={ds.emptyState}>
            <div className={ds.emptyIcon}>📋</div>
            <div className={ds.emptyTitle}>
              {search ? 'No matching guides' : 'No order guides yet'}
            </div>
            <div className={ds.emptyBody}>
              {search
                ? 'Try a different search term'
                : 'Ask your admin to set up purchase lists in Odoo'}
            </div>
          </div>
        )}

        {!loading &&
          !error &&
          filtered.map((guide) => (
            <div
              key={guide.id}
              className={`${ds.cardHover} mx-4 mb-3 overflow-hidden`}
              onClick={() =>
                guide.supplier &&
                onSelect(guide.id, guide.supplier.id)
              }
            >
              <div className={ds.cardBody}>
                {/* Supplier info */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center text-lg flex-shrink-0">
                    🛒
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-[15px] font-bold text-gray-900 truncate">
                        {guide.supplier?.name || guide.name}
                      </div>
                      <span className="ml-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 flex-shrink-0">
                        {guide.lineCount} items
                      </span>
                    </div>
                    <div className="text-[12px] text-gray-500 mt-0.5">
                      {guide.description || guide.name}
                    </div>
                  </div>
                </div>

                {/* Min order + last order */}
                {guide.supplier && guide.supplier.minOrderValue > 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      Min. €{guide.supplier.minOrderValue.toFixed(0)}
                    </span>
                  </div>
                )}

                {/* Contact buttons */}
                {guide.supplier &&
                  (guide.supplier.phone || guide.supplier.email) && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                      {guide.supplier.phone && (
                        <a
                          href={`tel:${guide.supplier.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-gray-600 no-underline active:bg-gray-100"
                        >
                          📞 Call
                        </a>
                      )}
                      {guide.supplier.email && (
                        <a
                          href={`mailto:${guide.supplier.email}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-gray-600 no-underline active:bg-gray-100"
                        >
                          📧 Email
                        </a>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
