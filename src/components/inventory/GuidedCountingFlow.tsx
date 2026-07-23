'use client';
import React, { useState, useEffect } from 'react';

/**
 * Guided, location-by-location counting shell.
 *
 * Additive: CountingSession stays the data/mutation controller and passes
 * `renderRow` (its existing ProductRow) so all count/offline logic is reused
 * unchanged. This component only adds the walking-route navigation + the
 * per-location counted/skipped state.
 */

interface Stop {
  bucket_id: number;
  location: { name: string; kind: string; photo: string | null; description: string | null } | null;
  product_ids: number[];
  status: string;
  skip_reason: string | null;
}

interface Props {
  stops: Stop[];
  productsById: Record<number, { id: number; name: string }>;
  statuses: Record<number, { status: string; skip_reason: string | null }>;
  renderRow: (product: { id: number; name: string }, bucketId: number) => React.ReactNode;
  onFinishStop: (bucketId: number) => void;
  onSkipStop: (bucketId: number, reason: string) => void;
  onReview: () => void;
}

// Fallback until the managed list loads (same defaults seeded server-side).
const DEFAULT_REASONS = ['Location was locked', 'Ran out of time', 'Nothing stored here today', 'Already counted earlier'];

export default function GuidedCountingFlow({ stops, productsById, statuses, renderRow, onFinishStop, onSkipStop, onReview }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [skipFor, setSkipFor] = useState<number | null>(null);

  const effStatus = (s: Stop) => statuses[s.bucket_id]?.status ?? s.status ?? 'pending';
  const stopName = (s: Stop) => (s.location ? s.location.name : 'Everything else');
  const withProducts = stops.filter((s) => s.product_ids.length > 0);
  const allDone = withProducts.every((s) => ['counted', 'skipped'].includes(effStatus(s)));
  const firstPending = withProducts.find((s) => effStatus(s) === 'pending');

  // ---- A single location open: count its products ----
  if (openId != null) {
    const s = stops.find((x) => x.bucket_id === openId);
    if (!s) { setOpenId(null); return null; }
    const products = s.product_ids.map((id) => productsById[id]).filter(Boolean);
    const idx = withProducts.findIndex((x) => x.bucket_id === s.bucket_id);
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-3 pb-3 bg-white border-b border-gray-100">
          <button onClick={() => setOpenId(null)} className="text-green-700 text-[var(--fs-sm)] font-semibold flex items-center gap-1 mb-2 active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7" /></svg>
            All locations
          </button>
          <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-green-700">Location {idx + 1} of {withProducts.length}</div>
          <h2 className="text-[var(--fs-xl)] font-bold text-gray-900 mt-0.5">{stopName(s)}</h2>
          {s.location?.photo && <img src={s.location.photo} alt="" className="w-full h-32 object-cover rounded-xl mt-2 border border-gray-200" />}
          {s.location?.description && <p className="text-[var(--fs-sm)] text-gray-500 mt-1.5">{s.location.description}</p>}
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-44">
          {products.length === 0
            ? <p className="text-center text-gray-400 py-8 text-[var(--fs-sm)]">No products here.</p>
            : products.map((p) => <div key={p.id}>{renderRow(p, s.bucket_id)}</div>)}
        </div>
        <div className="px-4 py-3 flex gap-3 border-t border-gray-100 bg-white">
          <button onClick={() => setSkipFor(s.bucket_id)} className="flex-1 py-3.5 rounded-xl border border-orange-200 text-orange-700 font-bold active:bg-orange-50">Skip location</button>
          <button onClick={() => { onFinishStop(s.bucket_id); setOpenId(null); }} className="flex-1 py-3.5 rounded-xl bg-green-600 text-white font-bold shadow-lg shadow-green-600/30 active:bg-green-700 flex items-center justify-center gap-1.5">
            Finish
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M20 6L9 17l-5-5" /></svg>
          </button>
        </div>
        {skipFor != null && (
          <SkipSheet name={stopName(s)}
            onPick={(r) => { onSkipStop(skipFor, r); setSkipFor(null); setOpenId(null); }}
            onClose={() => setSkipFor(null)} />
        )}
      </div>
    );
  }

  // ---- The route checklist ----
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 pb-36">
      <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-2">Your route · {withProducts.length} stop{withProducts.length !== 1 ? 's' : ''}</p>
      {withProducts.map((s, i) => {
        const st = effStatus(s);
        const isNext = firstPending && s.bucket_id === firstPending.bucket_id;
        return (
          <button key={s.bucket_id} onClick={() => setOpenId(s.bucket_id)}
            className={`w-full flex items-center gap-3 p-3 rounded-2xl border mb-2 text-left bg-white active:scale-[0.99] transition-transform ${isNext ? 'border-green-500 ring-2 ring-green-100' : 'border-gray-200'}`}>
            <div className="w-11 h-11 rounded-xl bg-cover bg-center bg-gray-100 flex items-center justify-center text-[var(--fs-sm)] font-bold text-gray-500 flex-shrink-0"
              style={s.location?.photo ? { backgroundImage: `url(${s.location.photo})` } : undefined}>
              {!s.location?.photo && (i + 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-gray-900 truncate">{stopName(s)}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 truncate">
                {s.product_ids.length} item{s.product_ids.length !== 1 ? 's' : ''}{s.location?.description ? ` · ${s.location.description}` : ''}
              </div>
            </div>
            <StatusPill st={st} />
          </button>
        );
      })}
      <div className="mt-5">
        {allDone ? (
          <button onClick={onReview} className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
            Review &amp; submit
          </button>
        ) : (
          <>
            <button onClick={() => firstPending && setOpenId(firstPending.bucket_id)} className="w-full py-4 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
              Start counting
            </button>
            <p className="text-center text-[var(--fs-xs)] text-gray-500 mt-2">Count or skip every location to finish</p>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ st }: { st: string }) {
  if (st === 'counted') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-50 text-green-700 flex-shrink-0">Done</span>;
  if (st === 'skipped') return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 flex-shrink-0">Skipped</span>;
  return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">To do</span>;
}

function SkipSheet({ name, onPick, onClose }: { name: string; onPick: (r: string) => void; onClose: () => void }) {
  // Skip-count reasons are a managed list (an admin curates them in Settings).
  const [reasons, setReasons] = useState<string[]>(DEFAULT_REASONS);
  useEffect(() => {
    fetch('/api/managed-lists/skip-reasons').then((r) => (r.ok ? r.json() : null)).then((d) => {
      // Reflect the actual managed list, incl. an intentionally-emptied one —
      // don't resurrect the hardcoded defaults. Defaults only stand in on a
      // failed request (the .catch below leaves them untouched).
      if (Array.isArray(d?.items)) setReasons(d.items.map((i: { label: string }) => i.label));
    }).catch(() => { /* request failed — keep the fallback defaults */ });
  }, []);
  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={onClose}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[var(--fs-lg)] font-bold mb-1">Skip {name}?</h3>
        <p className="text-[var(--fs-sm)] text-gray-500 mb-3">Pick a reason — your manager will see it.</p>
        {reasons.map((r) => (
          <button key={r} onClick={() => onPick(r)} className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 font-semibold mb-2 active:bg-gray-50 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />{r}
          </button>
        ))}
        <button onClick={onClose} className="w-full py-3.5 rounded-xl bg-gray-100 font-bold mt-1">Cancel</button>
      </div>
    </div>
  );
}
