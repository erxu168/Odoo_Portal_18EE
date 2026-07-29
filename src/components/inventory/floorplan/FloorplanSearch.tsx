'use client';
/**
 * Search-first finding (the Home-Depot pattern from the mock): the empty,
 * focused field shows a browsable PLACES directory (rooms, then utility
 * points); typing ≥2 characters searches products (with category) and places
 * together. Everything is local — the manifest already carries the index.
 */
import { useMemo, useRef, useState } from 'react';
import type { FloorplanManifest } from '@/lib/inventory-floorplan/manifest';

interface Props {
  manifest: FloorplanManifest;
  activeFloorId: number | null;
  onPick: (locationId: number) => void;
}

interface Row {
  key: string;
  locationId: number;
  main: string;
  sub: string;
  color: string;
  icon: string;
  tag: 'PRODUCT' | 'ROOM' | 'UTILITY' | 'SPOT';
}

export default function FloorplanSearch({ manifest, activeFloorId, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const typeInfo = useMemo(() => {
    const m: Record<string, { color: string; icon: string; label: string }> = {};
    for (const t of manifest.types) m[t.key] = { color: t.color, icon: t.icon, label: t.label };
    return m;
  }, [manifest.types]);

  const floorsById = useMemo(() => new Map(manifest.floors.map(f => [f.id, f])), [manifest.floors]);

  const placeRow = (p: FloorplanManifest['places'][number]): Row => {
    const t = typeInfo[p.typeKey] ?? { color: '#64748B', icon: '📍', label: p.typeKey };
    const floor = floorsById.get(p.floorId);
    const floorTag = p.floorId === activeFloorId ? '' : floor ? ` · ${floor.code || floor.name}` : '';
    return {
      key: `pl-${p.locationId}`,
      locationId: p.locationId,
      main: p.label,
      sub: `${p.room ? `${p.room} · ` : ''}${t.label}${floorTag}`,
      color: t.color,
      icon: t.icon,
      tag: p.bucket === 'room' ? 'ROOM' : p.bucket === 'utility' ? 'UTILITY' : 'SPOT',
    };
  };

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sortActiveFirst = (a: FloorplanManifest['places'][number], b: FloorplanManifest['places'][number]) =>
      Number(b.floorId === activeFloorId) - Number(a.floorId === activeFloorId);

    if (q.length < 2) {
      // Places directory: rooms first, then utility points; active floor first.
      const rooms = manifest.places.filter(p => p.bucket === 'room').sort(sortActiveFirst);
      const utils = manifest.places.filter(p => p.bucket === 'utility').sort(sortActiveFirst);
      return [...rooms, ...utils].map(placeRow);
    }

    const productRows: Row[] = manifest.products
      .filter(p => p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q))
      .slice(0, 6)
      .flatMap(p => {
        // prefer a placement on the active floor, else the first placed one
        const placed = p.locationIds
          .map(id => manifest.places.find(pl => pl.locationId === id))
          .filter((pl): pl is NonNullable<typeof pl> => pl != null)
          .sort(sortActiveFirst);
        const at = placed[0];
        if (!at) return [];
        const t = typeInfo[at.typeKey] ?? { color: '#64748B', icon: '📍', label: at.typeKey };
        return [{
          key: `pr-${p.id}`,
          locationId: at.locationId,
          main: p.name,
          sub: `${p.category ?? 'Product'} · ${at.label}${at.room ? ` · ${at.room}` : ''}`,
          color: t.color,
          icon: t.icon,
          tag: 'PRODUCT' as const,
        }];
      });

    const placeRows = manifest.places
      .filter(p => p.label.toLowerCase().includes(q) || (p.room ?? '').toLowerCase().includes(q))
      .sort(sortActiveFirst)
      .slice(0, 8)
      .map(placeRow);

    return [...productRows, ...placeRows];
  }, [query, manifest, activeFloorId, typeInfo, floorsById]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r: Row) => {
    setQuery('');
    setOpen(false);
    onPick(r.locationId);
  };

  return (
    <div ref={boxRef} className="relative z-30 px-3 pt-2">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search a product or a place…"
        aria-label="Search a product or a place"
        className="h-11 w-full rounded-xl border-[1.5px] border-gray-200 bg-white px-4 text-[15px] text-gray-900 outline-none focus:border-blue-600"
      />
      {open && rows.length > 0 && (
        <div className="absolute left-3 right-3 top-[52px] max-h-64 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
          {query.trim().length < 2 && (
            <div className="border-b border-gray-100 px-4 py-2 text-[12px] font-medium text-gray-500">
              All places — or type to search products too
            </div>
          )}
          {rows.map(r => (
            <button
              key={r.key}
              onMouseDown={e => e.preventDefault() /* keep focus so onBlur doesn't race the click */}
              onClick={() => pick(r)}
              className="flex min-h-[44px] w-full items-center gap-2.5 border-b border-gray-50 px-4 py-2 text-left last:border-b-0 active:bg-gray-50"
            >
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-gray-900">{r.icon} {r.main}</span>
                <span className="block truncate text-[11.5px] text-gray-500">{r.sub}</span>
              </span>
              <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{r.tag}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && rows.length === 0 && (
        <div className="absolute left-3 right-3 top-[52px] rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-500 shadow-xl">
          Nothing found — try a product name, a spot code like “SLF 1”, or a room.
        </div>
      )}
    </div>
  );
}
