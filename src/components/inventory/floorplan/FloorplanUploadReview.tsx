'use client';
/**
 * The review screen between upload and publish: everything detected on the
 * plan, grouped by proposed room, with the type/room/keep decisions the
 * owner makes before anything becomes a real spot. Noise (legend, dimensions)
 * arrives pre-ignored; same-room duplicate codes are flagged BEFORE publish
 * so the server's blocking answer is never a surprise.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { normalizeCode } from '@/lib/inventory-floorplan/geometry';
import type { CandidateRow, Pt } from '@/lib/inventory-floorplan/types';
import type { FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';

interface ReviewPayload {
  revision: { id: number; floor_id: number; revision_no: number; status: string; version: number; raster_url: string; raster_width: number; raster_height: number };
  floor: { id: number; name: string; code: string; company_id: number };
  candidates: CandidateRow[];
}

const NO_ROOM = '· no room ·';

export default function FloorplanUploadReview({ revisionId }: { revisionId: number }) {
  const router = useRouter();
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [cands, setCands] = useState<CandidateRow[]>([]);
  const [types, setTypes] = useState<FloorplanTypeInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(() => {
    const token = ++tokenRef.current;
    Promise.all([
      fetch(`/api/inventory/floorplan-revisions/${revisionId}/review`).then(r => r.json().then(d => ({ ok: r.ok, d }))),
      fetch('/api/inventory/floorplan').then(r => r.json()),
    ]).then(([rev, man]) => {
      if (tokenRef.current !== token) return;
      if (!rev.ok) { setError(rev.d.error ?? 'Could not load the review'); return; }
      setData(rev.d as ReviewPayload);
      const loaded = (rev.d as ReviewPayload).candidates.map(c =>
        c.disposition === 'pending'
          ? { ...c, disposition: (c.proposed_kind === 'spot' || c.proposed_kind === 'room' ? 'create' : 'ignored') as CandidateRow['disposition'] }
          : c,
      );
      setCands(loaded);
      setTypes(man.manifest?.types ?? []);
    }).catch(() => { if (tokenRef.current === token) setError('Could not load — check your connection'); });
  }, [revisionId]);
  useEffect(() => { load(); }, [load]);

  const spotTypes = useMemo(() => types.filter(t => !['floor', 'area', 'room'].includes(t.key)), [types]);
  const roomNames = useMemo(
    () => Array.from(new Set(cands.filter(c => c.proposed_kind === 'room' && c.disposition !== 'ignored').map(c => c.raw_text.trim()))),
    [cands],
  );

  const patch = (id: number, updates: Partial<CandidateRow>) =>
    setCands(list => list.map(c => (c.id === id ? { ...c, ...updates } : c)));

  // Same-room duplicate pre-check (the server blocks these too — surface early).
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    for (const c of cands) {
      if (c.proposed_kind !== 'spot' || c.disposition !== 'create') continue;
      const key = `${c.proposed_room ?? ''}|${normalizeCode(c.normalized_text)}`;
      if (seen.has(key)) { dupes.add(c.id); dupes.add(seen.get(key)!); }
      else seen.set(key, c.id);
    }
    return dupes;
  }, [cands]);

  const keptSpots = cands.filter(c => c.proposed_kind === 'spot' && c.disposition === 'create').length;
  const keptRooms = cands.filter(c => c.proposed_kind === 'room' && c.disposition === 'create').length;

  const grouped = useMemo(() => {
    const groups = new Map<string, CandidateRow[]>();
    for (const c of cands.filter(x => x.proposed_kind === 'spot')) {
      const room = c.proposed_room?.trim() || NO_ROOM;
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room)!.push(c);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [cands]);

  const noise = cands.filter(c => c.proposed_kind === 'other');
  const rooms = cands.filter(c => c.proposed_kind === 'room');

  const saveAndPublish = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const updates = cands.map(c => ({
        id: c.id,
        disposition: c.disposition === 'pending' ? 'create' : c.disposition,
        proposed_type: c.proposed_type,
        proposed_room: c.proposed_room,
        ignored_reason: c.disposition === 'ignored' ? (c.ignored_reason ?? 'review') : null,
      }));
      const put = await fetch(`/api/inventory/floorplan-revisions/${revisionId}/review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }),
      });
      if (!put.ok) { setError((await put.json()).error ?? 'Could not save the review'); setBusy(false); return; }
      const pub = await fetch(`/api/inventory/floorplan-revisions/${revisionId}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: data.revision.version }),
      });
      const d = await pub.json();
      if (!pub.ok) {
        setError(d.detail ? `${d.error}: ${d.detail}` : d.error ?? 'Publish failed');
        setBusy(false);
        return;
      }
      router.push('/inventory/floorplan?published=1');
    } catch {
      setError('Publish failed — check your connection');
      setBusy(false);
    }
  };

  const typePill = (c: CandidateRow) => {
    const t = types.find(x => x.key === c.proposed_type);
    return (
      <select
        value={c.proposed_type ?? ''}
        onChange={e => patch(c.id, { proposed_type: e.target.value })}
        aria-label={`Type of ${c.raw_text}`}
        className="h-8 flex-shrink-0 rounded-full border-0 px-2.5 text-[11px] font-bold text-white outline-none"
        style={{ background: t?.color ?? '#64748B' }}
      >
        {spotTypes.map(x => <option key={x.key} value={x.key}>{x.icon} {x.label}</option>)}
      </select>
    );
  };

  if (error && !data) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <AppHeader supertitle="INVENTORY · FLOORPLAN" title="Review" showBack onBack={() => router.push('/inventory/floorplan/manage')} />
        <div className="p-4"><div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</div></div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <AppHeader supertitle="INVENTORY · FLOORPLAN" title="Review" showBack onBack={() => router.push('/inventory/floorplan/manage')} />
        <div className="flex flex-1 items-center justify-center text-[13px] text-gray-500">Loading…</div>
      </div>
    );
  }

  const already = data.revision.status !== 'draft';

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 pb-24">
      <AppHeader
        supertitle={`INVENTORY · ${data.floor.name.toUpperCase()}`}
        title={`Review plan v${data.revision.revision_no}`}
        showBack
        onBack={() => router.push('/inventory/floorplan/manage')}
      />
      <div className="flex flex-col gap-3 p-4">
        {already && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] font-medium text-amber-800">
            This plan version is already published. Upload a new version to change it.
          </div>
        )}
        {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</div>}

        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="relative overflow-hidden rounded-xl border border-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.revision.raster_url} alt={`Plan of ${data.floor.name}`} className="block w-full" />
            {cands.filter(c => c.disposition === 'create').map(c => (
              <Box key={c.id} poly={c.polygon} color={typeColor(types, c)} big={highlightId === c.id} />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-gray-500">
            <b className="text-gray-800">{keptSpots} storage labels</b> and <b className="text-gray-800">{keptRooms} rooms</b> will be
            created — tap a row to see it on the plan, untick anything that is not a real place.
          </p>
        </div>

        {duplicates.size > 0 && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] font-medium text-amber-800">
            The same code appears twice in one room ({duplicates.size} labels) — change the room, the code, or untick one before publishing.
          </div>
        )}

        {grouped.map(([room, list]) => (
          <div key={room} className="rounded-2xl border border-gray-200 bg-white p-3">
            <p className="mb-1 flex items-center gap-2 px-1 text-[12px] font-extrabold text-gray-900">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {room === NO_ROOM ? 'Not in a room' : room}
              <span className="ml-auto text-[10.5px] font-bold text-gray-400">{list.length}</span>
            </p>
            {list.map(c => (
              <div
                key={c.id}
                onClick={() => setHighlightId(c.id)}
                className={`flex min-h-[48px] items-center gap-2 rounded-xl border px-2.5 py-1.5 mb-1.5 last:mb-0 ${duplicates.has(c.id) ? 'border-amber-400 bg-amber-50' : 'border-gray-100 bg-white'}`}
              >
                <button
                  onClick={e => { e.stopPropagation(); patch(c.id, { disposition: c.disposition === 'ignored' ? 'create' : 'ignored' }); }}
                  aria-label={c.disposition === 'ignored' ? `Keep ${c.raw_text}` : `Ignore ${c.raw_text}`}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white ${c.disposition === 'ignored' ? 'bg-gray-300' : 'bg-green-600'}`}
                >
                  {c.disposition === 'ignored' ? '–' : '✓'}
                </button>
                <span className={`min-w-[52px] text-[13px] font-bold ${c.disposition === 'ignored' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {normalizeCode(c.normalized_text)}
                </span>
                {typePill(c)}
                <select
                  value={c.proposed_room ?? NO_ROOM}
                  onChange={e => patch(c.id, { proposed_room: e.target.value === NO_ROOM ? null : e.target.value })}
                  aria-label={`Room of ${c.raw_text}`}
                  className="ml-auto h-8 max-w-[42%] flex-shrink rounded-lg border border-gray-200 bg-white px-1.5 text-[11.5px] font-semibold text-gray-600 outline-none"
                >
                  <option value={NO_ROOM}>· no room ·</option>
                  {roomNames.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}

        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <p className="mb-1 px-1 text-[12px] font-extrabold text-gray-900">Rooms ({rooms.filter(r => r.disposition === 'create').length} kept)</p>
          <div className="flex flex-wrap gap-1.5">
            {rooms.map(c => (
              <button
                key={c.id}
                onClick={() => { patch(c.id, { disposition: c.disposition === 'ignored' ? 'create' : 'ignored' }); setHighlightId(c.id); }}
                className={`h-9 rounded-full border px-3 text-[12px] font-semibold ${c.disposition === 'ignored' ? 'border-gray-200 bg-gray-100 text-gray-400 line-through' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
              >
                🚪 {c.raw_text.trim()}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <p className="mb-1 px-1 text-[12px] font-extrabold text-gray-900">Ignored ({noise.filter(n => n.disposition === 'ignored').length})</p>
          <p className="px-1 pb-1 text-[11.5px] text-gray-500">Legend, dimensions and other text that is not a place. Tap to keep one after all.</p>
          <div className="flex flex-wrap gap-1.5">
            {noise.slice(0, 40).map(c => (
              <button
                key={c.id}
                onClick={() => patch(c.id, { disposition: c.disposition === 'ignored' ? 'create' : 'ignored', proposed_kind: 'spot' as never })}
                className={`h-8 max-w-full truncate rounded-full border px-2.5 text-[11px] font-medium ${c.disposition === 'ignored' ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-green-300 bg-green-50 text-green-800'}`}
              >
                {c.raw_text.trim().slice(0, 30)}
              </button>
            ))}
            {noise.length > 40 && <span className="self-center text-[11px] text-gray-400">+{noise.length - 40} more</span>}
          </div>
        </div>
      </div>

      {!already && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <button
            onClick={saveAndPublish}
            disabled={busy || duplicates.size > 0}
            className="h-12 w-full rounded-full bg-green-600 text-[15px] font-bold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Publishing…' : `Create ${keptSpots} spots on ${data.floor.name}`}
          </button>
        </div>
      )}
    </div>
  );
}

function typeColor(types: FloorplanTypeInfo[], c: CandidateRow): string {
  if (c.proposed_kind === 'room') return '#F59E0B';
  return types.find(t => t.key === c.proposed_type)?.color ?? '#64748B';
}

function Box({ poly, color, big }: { poly: Pt[]; color: string; big: boolean }) {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  const l = Math.min(...xs), t = Math.min(...ys);
  const w = Math.max(...xs) - l, h = Math.max(...ys) - t;
  return (
    <span
      className="pointer-events-none absolute rounded-[3px]"
      style={{
        left: `${l * 100}%`, top: `${t * 100}%`,
        width: `${Math.max(w * 100, 0.8)}%`, height: `${Math.max(h * 100, 0.8)}%`,
        border: `${big ? 2.5 : 1}px ${big ? 'solid' : 'dashed'} ${color}`,
        boxShadow: big ? `0 0 0 4px ${color}55` : undefined,
        zIndex: big ? 5 : 1,
      }}
    />
  );
}
