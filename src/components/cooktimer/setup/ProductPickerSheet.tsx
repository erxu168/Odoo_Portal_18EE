'use client';
import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface Hit { id: number; name: string; uom_name?: string; category?: string; }

/** Search + pick a single Odoo product (product.product). Feeds the profile's
 *  odoo_product_id. Debounced, cancels stale requests. */
export default function ProductPickerSheet({
  onClose, onPick,
}: {
  onClose: () => void;
  onPick: (p: { id: number; name: string }) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const ctlRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    // Bump a generation and clear immediately so results from a previous query are
    // never left on screen (and tappable) during the debounce / next request.
    const gen = ++genRef.current;
    setResults([]);
    setLoading(true);
    const t = setTimeout(() => {
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=30`, { signal: ctl.signal })
        .then(r => r.json())
        .then(d => { if (gen === genRef.current) setResults(Array.isArray(d.products) ? d.products : []); })
        .catch(() => { /* aborted or failed */ })
        .finally(() => { if (gen === genRef.current) setLoading(false); });
    }, 250);
    // Abort any in-flight request too, so a slow response for the previous query
    // can never land under the new one and get picked by mistake.
    return () => { clearTimeout(t); ctlRef.current?.abort(); };
  }, [q]);

  return (
    <BottomSheet title="Pick a product" onClose={onClose}>
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search products…"
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] mb-3 focus:outline-none focus:border-sky-400"
      />
      <div className="flex flex-col divide-y divide-gray-100 max-h-[52vh] overflow-y-auto">
        {results.map(p => (
          <button
            key={p.id}
            onClick={() => onPick({ id: p.id, name: p.name })}
            className="text-left py-3 px-1 active:bg-gray-50"
          >
            <div className="font-semibold text-[15px] text-gray-900">{p.name}</div>
            {p.category && <div className="text-xs text-gray-400">{p.category}</div>}
          </button>
        ))}
        {loading && <div className="text-sm text-gray-400 py-3 text-center">Searching…</div>}
        {!loading && results.length === 0 && (
          <div className="text-sm text-gray-400 py-6 text-center">
            {q ? 'No products found.' : 'Type to search the product catalog.'}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
