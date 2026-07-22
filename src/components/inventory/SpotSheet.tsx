'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Spinner, ProductThumb } from './ui';
import { buildLocationTree } from '@/lib/location-tree';

/**
 * "Where does it live?" — edit ONE product's home spots (multi-select).
 *
 * The home spots are the single global record (product_locations) that every
 * door edits: the Locations screen, Product Settings and the list builder all
 * open this same sheet / write the same rows. Saving affects every list that
 * contains the product (future counts — open counts keep their frozen snapshot).
 *
 * Locations are grouped by area, each with its photo + "where to stand" note
 * so the manager assigns by sight. Ticking nothing = "no specific spot": the
 * product counts under "Everything else".
 */
interface SpotRow {
  id: number;
  parent_id: number | null;
  name: string;
  kind: string;
  photo: string | null;
  description: string | null;
  sort_order: number;
}

export default function SpotSheet({ product, hasImage, companyId, initialSpotIds, onSaved, onClose, baseZ = 110 }: {
  product: { id: number; name: string };
  hasImage: boolean;
  companyId: number;
  /** The product's current home spots (from the caller's placement map). */
  initialSpotIds: number[];
  /** Called with the saved spot ids so the caller can update its map. */
  onSaved: (spotIds: number[]) => void;
  onClose: () => void;
  /** z-index so this can stack above a ProductDetail overlay. */
  baseZ?: number;
}) {
  const [spots, setSpots] = useState<SpotRow[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set(initialSpotIds));
  const [loading, setLoading] = useState(true);
  // Save stays DISABLED until both the spots and the product's CURRENT home
  // spots are loaded — saving from a stale/failed state could overwrite newer
  // placements made elsewhere. Fail closed, never open.
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Spots AND the product's CURRENT home spots — fetched fresh on open so
        // a stale caller map (failed load / edited elsewhere) can never cause
        // this sheet to overwrite newer placements on save.
        const [locRes, curRes] = await Promise.all([
          fetch(`/api/inventory/count-locations?company_id=${companyId}`),
          fetch(`/api/inventory/product-locations?product_id=${product.id}`),
        ]);
        if (!locRes.ok || !curRes.ok) throw new Error('load');
        const d = await locRes.json();
        const locs: SpotRow[] = d.locations || [];
        setSpots(locs);
        const cur = await curRes.json();
        const companySpots = new Set(locs.map((l) => l.id));
        setChosen(new Set<number>((cur.location_ids || []).filter((id: number) => companySpots.has(id))));
        setReady(true);
      } catch {
        setError('Could not load this product’s spots — close and try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId, product.id]);

  // Areas (roots) with their child spots, in walking order.
  const tree = useMemo(() => buildLocationTree(spots as SpotRow[]), [spots]);

  function toggle(id: number) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/product-locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odoo_product_id: product.id,
          company_id: companyId,
          count_location_ids: Array.from(chosen),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Could not save — try again.');
        return;
      }
      onSaved(Array.from(chosen));
      onClose();
    } catch {
      setError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  }

  function SpotToggle({ s, indent }: { s: SpotRow; indent: boolean }) {
    const on = chosen.has(s.id);
    return (
      <button onClick={() => toggle(s.id)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors ${indent ? 'ml-0' : ''} ${
          on ? 'bg-green-50 border-green-500' : 'bg-white border-gray-200 active:bg-gray-50'
        }`}>
        <span className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${on ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white'}`}>
          {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
        </span>
        <span className={`flex-1 min-w-0 truncate text-[var(--fs-base)] font-semibold ${on ? 'text-green-900' : 'text-gray-800'}`}>{s.name}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-label={`Home spots for ${product.name}`}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">Where does it live?</h3>
            <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Cancel</button>
          </div>
          <div className="flex items-center gap-2.5 mt-2">
            <ProductThumb productId={product.id} has={hasImage} size={36} />
            <div className="min-w-0">
              <div className="text-[var(--fs-base)] font-bold text-gray-900 truncate">{product.name}</div>
              <div className="text-[var(--fs-xs)] text-gray-500">Tick every spot it{'’'}s stored at — it{'’'}s counted at each</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? <Spinner /> : tree.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-[var(--fs-sm)]">
              No locations set up yet — create them under Inventory {'→'} Locations first.
            </p>
          ) : tree.map((area: any) => (
            <div key={area.id} className="mb-3 bg-gray-50 border border-gray-200 rounded-2xl p-2.5">
              <div className="flex items-center gap-2.5 px-1 pb-2">
                {area.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={area.photo} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
                ) : null}
                <div className="min-w-0">
                  <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{area.name}</div>
                  {area.description && <div className="text-[var(--fs-xs)] text-gray-500 truncate">{area.description}</div>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <SpotToggle s={area} indent={false} />
                {(area.children || []).map((c: any) => <SpotToggle key={c.id} s={c} indent />)}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-6 pt-2 border-t border-gray-100">
          {error && <p className="text-[12px] text-red-600 mb-2 font-semibold">{error}</p>}
          <div className="text-[var(--fs-xs)] text-gray-400 mb-2 text-center">
            {chosen.size === 0 ? 'No spot ticked — it will count under “Everything else”' : `${chosen.size} spot${chosen.size !== 1 ? 's' : ''} — counted at each, totals add up`}
          </div>
          <button onClick={save} disabled={saving || loading || !ready}
            className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 disabled:opacity-50 active:bg-green-700">
            {saving ? 'Saving…' : ready ? 'Save home spots' : 'Loading…'}
          </button>
        </div>
      </div>
    </div>
  );
}
