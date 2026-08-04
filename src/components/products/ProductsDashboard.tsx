'use client';

/**
 * Products module landing screen.
 *
 * Three tiles, not four. The portal's rule asks for a tile grid, not for the grid
 * to be padded: a tile that always reads zero stops being read at all, and then
 * the one that matters gets skipped with it.
 *
 * "Needs setup" earns its place because it is a genuine queue that is otherwise
 * forgotten — a barcode nobody recognised was scanned mid-count, a product was
 * started for it, and it sits inactive until somebody decides what it is. It
 * counts drafts from the drafts table directly rather than from the catalog,
 * because the catalog's relevance filter hides a product nothing uses yet, which
 * is every draft by definition.
 *
 * The catalog numbers are counted from THE SAME request the catalog screen makes
 * (`/api/inventory/products` with the same company, relevance and PoS flags,
 * asking only for the fields a count needs). That is the point — the catalog's
 * scope is company-aware and relevance-filtered, so a tile that built its own
 * query would drift from the list it opens, and "the numbers are wrong" is
 * reported long after the cause is forgotten. The draft count is the exception,
 * and for the same reason inverted: it must NOT come from that request.
 *
 * The "not counted in stock" strip is a STRIP rather than a tile because it is
 * temporary. Odoo 18 keeps "is this a physical good?" apart from "do we track
 * its quantity?", and nothing in the portal has ever answered the second — so
 * most of the catalog holds no stock figure and a count of it cannot be written
 * back. Once that is worked through the strip disappears; a tile would linger.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import CreateProductSheet from '@/components/products/CreateProductSheet';
import { useAddProduct } from '@/components/products/useAddProduct';
import { useCompany } from '@/lib/company-context';

interface Counts {
  total: number;
  notTracked: number;
  noPicture: number;
  needsSetup: number;
}

export type ProductsScreen = 'catalog' | 'photos' | 'untracked' | 'setup' | 'codes';

export default function ProductsDashboard({ onNavigate }: { onNavigate: (screen: ProductsScreen) => void }) {
  const { companyId } = useCompany();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the newest response may write state. Switching restaurant twice in
  // quick succession otherwise lets the FIRST reply land last and print the
  // wrong restaurant's numbers under the new name.
  const reqRef = useRef(0);
  const add = useAddProduct();

  useEffect(() => {
    if (!companyId) return;
    const token = ++reqRef.current;
    setCounts(null);
    setFailed(false);

    (async () => {
      try {
        const [prodRes, imgRes, setupRes] = await Promise.all([
          // The catalog screen's own query, slim. Same limit, so if the catalog
          // is truncated this reports the truncated number too rather than
          // promising more than tapping through delivers.
          fetch(`/api/inventory/products?limit=500&include_pos=1&company_id=${companyId}&relevant=1&slim=1`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('products')))),
          // NOT caught into an empty list. "The picture service is down" and
          // "no product has a picture" are different facts, and quietly
          // reporting the first as the second would put 600 on a badge and
          // send someone to a screen with nothing to do.
          fetch('/api/inventory/product-images')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('images')))),
          // Drafts, from the drafts table rather than the catalog: the catalog's
          // relevance filter hides a product nothing uses yet, which is every
          // draft. Its failure is tolerated — a broken setup count should not
          // blank the two tiles that did load.
          fetch('/api/products/setup')
            .then((r) => (r.ok ? r.json() : { drafts: [] }))
            .catch(() => ({ drafts: [] })),
        ]);
        if (token !== reqRef.current) return;

        const all: { id: number; active?: boolean; is_storable?: boolean }[] = prodRes.products || [];
        const drafts: unknown[] = (setupRes as { drafts?: unknown[] }).drafts || [];
        const withImages = new Set<number>(imgRes.with_images || []);
        // The catalog lists LIVE products, so these counts must too — counting
        // the inactive ones as well would make every tile read higher than the
        // list it opens.
        const live = all.filter((p) => p.active !== false);

        setCounts({
          total: live.length,
          notTracked: live.filter((p) => p.is_storable === false).length,
          noPicture: live.filter((p) => !withImages.has(p.id)).length,
          needsSetup: drafts.length,
        });
      } catch {
        if (token === reqRef.current) setFailed(true);
      }
    })();
  }, [companyId]);

  const tiles = [
    {
      key: 'catalog' as const,
      emoji: '📦',
      label: 'All products',
      sublabel: counts ? `${counts.total} · search and edit` : 'Search and edit',
      badge: 0,
      danger: false,
    },
    {
      key: 'setup' as const,
      emoji: '🧾',
      label: 'Needs setup',
      sublabel: 'Scanned mid-count, not finished',
      badge: counts?.needsSetup ?? 0,
      // Red rather than green: these are products staff have already tried to
      // count and could not, so the number is a queue, not a score.
      danger: true,
    },
    {
      key: 'codes' as const,
      emoji: '🏷️',
      label: 'Product codes',
      sublabel: 'Needed before a shelf label can be scanned',
      // No badge: the dashboard does not count barcodes, and a made-up number
      // on a tile is worse than none. The screen itself opens on the real one.
      badge: 0,
      danger: false,
    },
    {
      key: 'photos' as const,
      emoji: '🖼️',
      label: 'Batch photos',
      sublabel: 'Add pictures to many at once',
      badge: counts?.noPicture ?? 0,
      danger: false,
    },
  ];

  return (
    <div className="px-4 py-5">
      {/* The blocking problem, stated in the terms it is actually felt in: not
          "is_storable is false" but "a count of these cannot be saved". */}
      {counts && counts.notTracked > 0 && (
        <button
          onClick={() => onNavigate('untracked')}
          className="w-full mb-4 text-left bg-white border border-amber-300 rounded-2xl p-4 active:scale-[0.99] transition-transform"
        >
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none mt-0.5" aria-hidden="true">⚠️</span>
            <div className="min-w-0 flex-1">
              <div className="text-[var(--fs-base)] font-bold text-gray-900">
                {counts.notTracked} product{counts.notTracked === 1 ? '' : 's'} without an Odoo stock number
              </div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                Counts of these still save in the portal, but Odoo&rsquo;s own quantity stays empty. Tap to see which.
              </div>
            </div>
          </div>
        </button>
      )}

      {failed && (
        <div role="status" className="mb-4 bg-white border border-gray-200 rounded-2xl p-4 text-[var(--fs-sm)] text-gray-500">
          Couldn&rsquo;t load the product counts just now. The tiles below still work.
        </div>
      )}

      <button
        onClick={add.start}
        className="w-full mb-4 bg-green-600 text-white rounded-2xl py-4 text-[var(--fs-base)] font-bold active:bg-green-700 active:scale-[0.99] transition-transform"
      >
        + Add a product
      </button>

      <ActionGrid
        items={tiles}
        getItemId={(t) => t.key}
        renderItem={(tile) => (
          <ActionCard
            emoji={tile.emoji}
            label={tile.label}
            subtitle={tile.sublabel}
            onClick={() => onNavigate(tile.key)}
            badge={tile.badge ? { value: tile.badge, tone: tile.danger ? 'danger' : 'count', ariaLabel: `${tile.badge} ${tile.label}` } : undefined}
          />
        )}
      />

      <CreateProductSheet
        open={add.open}
        initialName=""
        units={add.units}
        categories={add.categories}
        saving={add.saving}
        error={add.error}
        context="catalog"
        canCreateCategory
        onClose={add.close}
        onCreate={(p) => add.create({
          name: p.name, uom_id: p.uom_id, categ_id: p.categ_id,
          default_code: p.default_code, barcode: p.barcode, is_storable: p.is_storable,
        })}
      />
    </div>
  );
}
