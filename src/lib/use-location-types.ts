'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LOCATION_TYPES, locationType, type LocationType } from '@/lib/location-types';

/**
 * The full set of location types for a company = the built-in base
 * (LOCATION_TYPES, with icons + smart child suggestions) PLUS the company's
 * CUSTOM types (from /api/inventory/location-kinds, each with its own emoji).
 *
 * One hook so every surface — the Type dropdown, the spot picker, the tree,
 * printed labels — resolves a custom type's emoji/label the same way. Built-ins
 * come first; a custom type whose key OR label collides with a built-in is
 * dropped, so a stray row can never duplicate the base set. `reload()` refetches
 * after the manager adds/renames/deletes a type.
 */
export interface CustomKindRow { id: number; kind: string; label: string; icon: string; sort_order: number }

export function useLocationTypes(companyId?: number) {
  const [custom, setCustom] = useState<LocationType[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!companyId) { setCustom([]); return; }
    setLoading(true);
    fetch(`/api/inventory/location-kinds?company_id=${companyId}`)
      .then((r) => (r.ok ? r.json() : { kinds: [] }))
      .then((d) => {
        const builtinKeys = new Set(LOCATION_TYPES.map((t) => t.key.toLowerCase()));
        const builtinLabels = new Set(LOCATION_TYPES.map((t) => t.label.toLowerCase()));
        const rows = (d.kinds || []) as CustomKindRow[];
        const merged: LocationType[] = rows
          .filter((r) => !builtinKeys.has((r.kind || '').toLowerCase()) && !builtinLabels.has((r.label || '').toLowerCase()))
          .map((r) => ({ key: r.kind, label: r.label, icon: r.icon || '📍', suggests: [] as string[] }));
        // Keep the SAME reference when the content is unchanged (esp. the common
        // empty→empty case) so downstream memoized types/iconOf stay stable and
        // effects that depend on them (printed labels) don't rebuild for nothing.
        setCustom((prev) =>
          prev.length === merged.length && prev.every((p, i) => p.key === merged[i].key && p.label === merged[i].label && p.icon === merged[i].icon)
            ? prev : merged);
      })
      .catch(() => setCustom([]))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { reload(); }, [reload]);

  // Memoized so iconOf/labelOf are stable references between renders (only change
  // when the custom set changes) — lets effects that bake in an icon (e.g. printed
  // labels) safely depend on them without re-running every render.
  const types = useMemo<LocationType[]>(() => [...LOCATION_TYPES, ...custom], [custom]);
  const iconOf = useCallback(
    (kind: string | null | undefined): string =>
      types.find((t) => t.key === (kind || '').toLowerCase())?.icon || locationType(kind).icon,
    [types],
  );
  const labelOf = useCallback(
    (kind: string | null | undefined): string =>
      types.find((t) => t.key === (kind || '').toLowerCase())?.label || locationType(kind).label,
    [types],
  );

  return { types, custom, iconOf, labelOf, reload, loading };
}
