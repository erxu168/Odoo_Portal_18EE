'use client';
import React, { useState, useEffect } from 'react';
import { typeIcon, typeLabel } from '@/lib/location-types';

/**
 * The count, as ONE walk you scroll — not doors you open.
 *
 * Every product is on screen under the place it lives, in walking order, and is
 * counted in place. A route rail down the left draws the walk itself: a green
 * tick behind you, a solid dot where you are, hollow dots ahead.
 *
 * Additive: CountingSession stays the data/mutation controller and passes
 * `renderRow` (its ProductRow) so all count/offline logic is reused unchanged.
 * This component only lays out the route and owns the per-stop counted/skipped
 * state.
 */

interface Stop {
  bucket_id: number;
  location: { name: string; kind: string; photo: string | null; description: string | null } | null;
  product_ids: number[];
  status: string;
  skip_reason: string | null;
  ancestors?: { id: number; name: string; kind: string }[];
}

interface Props {
  stops: Stop[];
  productsById: Record<number, { id: number; name: string }>;
  statuses: Record<number, { status: string; skip_reason: string | null }>;
  renderRow: (product: { id: number; name: string }, bucketId: number) => React.ReactNode;
  /** How many of a stop's lines are counted — drives the per-stop progress + auto-collapse. */
  stopProgress: (bucketId: number, productIds: number[]) => { counted: number; total: number };
  onFinishStop: (bucketId: number) => void;
  onSkipStop: (bucketId: number, reason: string) => void;
  onReview: () => void;
}

// Fallback until the managed list loads (same defaults seeded server-side).
const DEFAULT_REASONS = ['Location was locked', 'Ran out of time', 'Nothing stored here today', 'Already counted earlier'];

/** A stop's walking address: the room it's in, then the shelf, with types spelled out. */
function addressOf(s: Stop): { room: string; roomKind: string; shelf: string; rest: string[] } {
  const anc = s.ancestors || [];
  const room = anc[0]?.name || '';
  const roomKind = anc[0]?.kind || 'area';
  const rest = anc.slice(1).map((a) => a.name);
  const shelf = s.location ? s.location.name : 'Everything else';
  return { room, roomKind, shelf, rest };
}

export default function GuidedCountingFlow({
  stops, productsById, statuses, renderRow, stopProgress, onFinishStop, onSkipStop, onReview,
}: Props) {
  const [skipFor, setSkipFor] = useState<number | null>(null);
  // Stops the user re-opened by hand after they auto-collapsed.
  const [reopened, setReopened] = useState<Set<number>>(new Set());

  const effStatus = (s: Stop) => statuses[s.bucket_id]?.status ?? s.status ?? 'pending';
  const withProducts = stops.filter((s) => s.product_ids.length > 0);
  const allDone = withProducts.every((s) => ['counted', 'skipped'].includes(effStatus(s)));

  // Group consecutive stops by the ROOM you walk to, so one trip = one rail step
  // (drawers D1–D8 in one fridge are one walk, not eight).
  const steps: { key: string; room: string; roomKind: string; stops: Stop[] }[] = [];
  withProducts.forEach((s) => {
    const { room, roomKind } = addressOf(s);
    // No room above it? Then this shelf is its own stop — grouping roomless
    // shelves would force one of their names onto the whole group.
    const key = room ? `${room}|${roomKind}` : `solo-${s.bucket_id}`;
    const last = steps[steps.length - 1];
    if (room && last && last.key === key) last.stops.push(s);
    else steps.push({ key, room, roomKind, stops: [s] });
  });

  const stepDone = (st: typeof steps[0]) =>
    st.stops.every((s) => {
      const { counted, total } = stopProgress(s.bucket_id, s.product_ids);
      return effStatus(s) === 'skipped' || (total > 0 && counted >= total);
    });
  const currentIdx = steps.findIndex((st) => !stepDone(st));

  // Auto-collapse relies on the browser's native scroll anchoring (overflow-anchor,
  // on by default): when a finished shelf folds away above you, the viewport keeps
  // its place on its own. A hand-rolled scrollBy here FOUGHT that and threw the
  // page to the top — measured 400 -> 0. Don't reintroduce one.
  return (
    <div className="flex-1 overflow-y-auto px-4 pt-3 pb-40">
      {steps.map((st, i) => {
        const done = stepDone(st);
        const isNow = i === currentIdx;
        const last = i === steps.length - 1;
        return (
          <div key={st.key} className="relative">
            {/* The rail runs behind the step's headings only — the count rows keep
                the full screen width (indenting them squeezed the numbers). */}
            {!last && <span className="absolute left-[10px] top-2 bottom-0 w-0.5 bg-gray-200" aria-hidden="true" />}
            <span
              className={`absolute left-0 top-0 w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center text-[11px] font-bold z-10 ${
                done ? 'bg-green-600 border-green-600 text-white'
                  : isNow ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100'
                  : 'bg-white border-blue-600 text-blue-700'
              }`}
              aria-hidden="true"
            >
              {done ? '✓' : i + 1}
            </span>

            <div className="pl-8 text-[var(--fs-base)] font-extrabold leading-tight">
              {st.room || (st.stops[0].location
                ? `${typeLabel(st.stops[0].location.kind)} ${st.stops[0].location.name}`
                : 'Not in a place yet')}
              <span className="block text-[var(--fs-xs)] font-semibold text-gray-400 mt-0.5">
                {(() => {
                  const n = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).total, 0);
                  const c = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).counted, 0);
                  return done ? `${n} thing${n !== 1 ? 's' : ''} · all counted` : `${c} of ${n} counted here`;
                })()}
              </span>
            </div>

            <div className="pb-4 pt-1">
              {st.stops.map((s) => {
                const { shelf, rest } = addressOf(s);
                const { counted, total } = stopProgress(s.bucket_id, s.product_ids);
                const skipped = effStatus(s) === 'skipped';
                const full = total > 0 && counted >= total;
                // A finished shelf folds away on its own; tapping the heading brings it back.
                const collapsed = (full || skipped) && !reopened.has(s.bucket_id);
                const label = s.location ? typeLabel(s.location.kind) : '';
                return (
                  <div key={s.bucket_id} className="mt-2 first:mt-1">
                    {!(st.stops.length === 1 && !st.room) && <button
                      onClick={() => setReopened((p) => {
                        const n = new Set(p);
                        if (n.has(s.bucket_id)) n.delete(s.bucket_id); else n.add(s.bucket_id);
                        return n;
                      })}
                      className="w-full flex items-center gap-1.5 text-left mb-1.5 pl-8 active:opacity-70"
                    >
                      <span className="text-[var(--fs-sm)] flex-shrink-0" aria-hidden="true">
                        {s.location ? typeIcon(s.location.kind) : '📦'}
                      </span>
                      <span className="text-[var(--fs-sm)] font-semibold text-gray-600 truncate">
                        {rest.length > 0 && <span className="text-gray-400">{rest.join(' › ')} › </span>}
                        {label && <span className="text-gray-500">{label} </span>}
                        <span className="font-extrabold text-gray-900">{shelf}</span>
                      </span>
                      <span className={`ml-auto flex-shrink-0 text-[var(--fs-xs)] font-bold ${
                        skipped ? 'text-orange-600' : full ? 'text-green-700' : 'text-gray-400'
                      }`}>
                        {skipped ? 'skipped' : `${counted}/${total}`}{(full || skipped) ? (collapsed ? ' ▸' : ' ▾') : ''}
                      </span>
                    </button>}

                    {!collapsed && (
                      <>
                        <div className="bg-white border border-gray-200 rounded-2xl px-3">
                          {s.product_ids.map((id) => productsById[id] && (
                            <div key={id}>{renderRow(productsById[id], s.bucket_id)}</div>
                          ))}
                        </div>
                        {!skipped && !full && (
                          <button onClick={() => setSkipFor(s.bucket_id)}
                            className="w-full text-right text-[var(--fs-xs)] font-bold text-gray-400 pt-1.5 pr-1 active:text-gray-600">
                            Nothing here {'→'}
                          </button>
                        )}
                        {skipped && statuses[s.bucket_id]?.skip_reason && (
                          <p className="text-[var(--fs-xs)] text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5 mt-1.5">
                            Skipped {'—'} {statuses[s.bucket_id]?.skip_reason}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-2">
        <button onClick={onReview}
          className={`w-full py-4 rounded-xl text-[var(--fs-lg)] font-bold transition-all ${
            allDone
              ? 'bg-green-600 text-white shadow-lg shadow-green-600/30 active:bg-green-700'
              : 'bg-white border border-gray-200 text-gray-700 active:bg-gray-50'
          }`}>
          Review {'&'} submit
        </button>
        <p className="text-center text-[var(--fs-xs)] text-gray-500 mt-2">
          You can submit with things uncounted {'—'} the manager sees what was missed.
        </p>
      </div>

      {skipFor !== null && (
        <SkipSheet
          name={(() => { const s = stops.find((x) => x.bucket_id === skipFor); return s ? addressOf(s).shelf : 'this spot'; })()}
          onPick={(r) => { onSkipStop(skipFor, r); setSkipFor(null); }}
          onClose={() => setSkipFor(null)}
        />
      )}
    </div>
  );
}

function SkipSheet({ name, onPick, onClose }: { name: string; onPick: (r: string) => void; onClose: () => void }) {
  const [reasons, setReasons] = useState<string[]>(DEFAULT_REASONS);
  useEffect(() => {
    // Skip-count reasons are a managed list (an admin curates them in Settings).
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
        <h3 className="text-[var(--fs-lg)] font-bold mb-1">Nothing counted at {name}?</h3>
        <p className="text-[var(--fs-sm)] text-gray-500 mb-3">Pick a reason {'—'} your manager will see it.</p>
        {reasons.map((r) => (
          <button key={r} onClick={() => onPick(r)}
            className="w-full text-left px-4 py-3.5 rounded-xl border border-gray-200 font-semibold mb-2 active:bg-gray-50 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />{r}
          </button>
        ))}
        <button onClick={onClose} className="w-full py-3.5 rounded-xl bg-gray-100 font-bold mt-1">Cancel</button>
      </div>
    </div>
  );
}
