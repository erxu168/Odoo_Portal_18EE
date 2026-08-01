'use client';
import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { typeIcon, typeLabel } from '@/lib/location-types';

// Loaded only when someone actually opens the map — keeps Leaflet out of the
// counting bundle. Rendered as an OVERLAY so the count state stays mounted.
const FloorplanOverlay = dynamic(() => import('@/components/inventory/floorplan/FloorplanOverlay'), { ssr: false });

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
  onSkipStop: (bucketId: number, reason: string) => void;
  /** Take back a skip — the place gets counted after all. */
  onUnskipStop: (bucketId: number) => void;
  onReview: () => void;
}

// Fallback until the managed list loads (same defaults seeded server-side).
const DEFAULT_REASONS = ['Location was locked', 'Ran out of time', 'Nothing stored here today', 'Already counted earlier'];

/** A stop's walking address: the room it's in, then the shelf, with types spelled out. */
function addressOf(s: Stop): { room: string; roomId: number | null; roomKind: string; shelf: string; rest: string[] } {
  const anc = s.ancestors || [];
  const room = anc[0]?.name || '';
  const roomId = anc[0]?.id ?? null;
  const roomKind = anc[0]?.kind || 'area';
  const rest = anc.slice(1).map((a) => a.name);
  const shelf = s.location ? s.location.name : 'Everything else';
  return { room, roomId, roomKind, shelf, rest };
}

/** True when a spot's own name already contains its type word(s), so prefixing
 *  the type would just repeat it ("Walk-in cooler Walk in Cooler 1"). The icon
 *  shows the kind anyway; cryptic names like "D1" still get the "Drawer" prefix.
 *  Matches on WHOLE words (so "Broom Cupboard" doesn't swallow "Room"), and a
 *  slash label like "Bin / crate" counts if EITHER word appears. */
function nameIncludesType(shelf: string, label: string): boolean {
  if (!label) return false;
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hay = ` ${words(shelf)} `;
  return label.split('/').some((alt) => {
    const needle = words(alt);
    return needle.length > 0 && hay.includes(` ${needle} `);
  });
}

export default function GuidedCountingFlow({
  stops, productsById, statuses, renderRow, stopProgress, onSkipStop, onUnskipStop, onReview,
}: Props) {
  const [skipFor, setSkipFor] = useState<number | null>(null);
  // Stops the user re-opened by hand after they auto-collapsed.
  const [reopened, setReopened] = useState<Set<number>>(new Set());
  const [mapSpotId, setMapSpotId] = useState<number | null>(null);

  const effStatus = (s: Stop) => statuses[s.bucket_id]?.status ?? s.status ?? 'pending';
  const withProducts = stops.filter((s) => s.product_ids.length > 0);

  // Group consecutive stops by the ROOM you walk to, so one trip = one rail step
  // (drawers D1–D8 in one fridge are one walk, not eight).
  const steps: { key: string; room: string; roomKind: string; stops: Stop[] }[] = [];
  withProducts.forEach((s) => {
    const { room, roomId, roomKind } = addressOf(s);
    // Group on the room's ID: two different rooms can share a name, and merging
    // them would send staff to the wrong place. No room above it? Then this
    // shelf is its own step — grouping roomless shelves would force one of
    // their names onto the whole group.
    const key = roomId != null ? `room-${roomId}` : `solo-${s.bucket_id}`;
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
  // "Done" is derived from the numbers on the page, never from a button nobody
  // presses any more — the same rule the server now uses to allow submitting.
  const allDone = steps.every(stepDone);

  const toggleReopen = (bucketId: number) => setReopened((p) => {
    const n = new Set(p);
    if (n.has(bucketId)) n.delete(bucketId); else n.add(bucketId);
    return n;
  });

  // The skip / un-skip action for a drawer — it lives INSIDE that drawer's card,
  // so there's never a question of which spot a floating "Nothing here" belongs to.
  const drawerFooter = (s: Stop, full: boolean, skipped: boolean) => (
    skipped ? (
      <div className="flex items-center gap-2 text-[var(--fs-xs)] text-orange-700 bg-orange-50 px-3 py-2 border-t border-orange-100">
        <span className="min-w-0">
          Skipped{statuses[s.bucket_id]?.skip_reason ? ` — ${statuses[s.bucket_id]?.skip_reason}` : ''}
        </span>
        <button onClick={() => onUnskipStop(s.bucket_id)}
          className="ml-auto flex-shrink-0 font-bold underline active:opacity-60">
          Count it after all
        </button>
      </div>
    ) : !full ? (
      <button onClick={() => setSkipFor(s.bucket_id)}
        className="w-full text-right text-[var(--fs-xs)] font-bold text-gray-400 px-3 py-2 border-t border-gray-100 bg-white active:text-gray-600">
        Nothing in this drawer {'→'}
      </button>
    ) : null
  );

  // Auto-collapse relies on the browser's native scroll anchoring (overflow-anchor,
  // on by default): when a finished shelf folds away above you, the viewport keeps
  // its place on its own. A hand-rolled scrollBy here FOUGHT that and threw the
  // page to the top — measured 400 -> 0. Don't reintroduce one.
  return (
    <div className="flex-1 overflow-y-auto px-4 pt-3 pb-40">
      {/* Jump strip: a 40-line count is a very long page — this is how you get
          back to a place without scrolling past everything. */}
      {steps.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-3">
          {steps.map((st, i) => {
            const d = stepDone(st);
            const now = i === currentIdx;
            return (
              <button key={`${st.key}#${i}`}
                onClick={() => document.getElementById(`walk-step-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[var(--fs-xs)] font-bold border transition-colors ${
                  d ? 'bg-green-50 border-green-200 text-green-700'
                    : now ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}>
                {d ? '✓ ' : ''}{st.room || (st.stops[0].location ? st.stops[0].location.name : 'No place')}
              </button>
            );
          })}
        </div>
      )}

      {steps.map((st, i) => {
        const done = stepDone(st);
        const isNow = i === currentIdx;
        // A step that IS a single roomless shelf ("Everything else", a shelf with
        // no room above it) names itself in the AREA header, so its products sit
        // directly under it — no second heading. Fold it from that header.
        const solo = st.stops.length === 1 && !st.room;
        const soloBucket = st.stops[0].bucket_id;
        const soloOpen = solo && reopened.has(soloBucket);
        // Area totals for the section header count.
        const areaTotal = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).total, 0);
        const areaCounted = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).counted, 0);
        const soloLoc = st.stops[0].location;
        const areaName = st.room || (soloLoc
          ? (nameIncludesType(soloLoc.name, typeLabel(soloLoc.kind)) ? soloLoc.name : `${typeLabel(soloLoc.kind)} ${soloLoc.name}`)
          : 'Not in a place yet');
        const soloS = st.stops[0];
        const soloProg = stopProgress(soloS.bucket_id, soloS.product_ids);
        const soloSkipped = effStatus(soloS) === 'skipped';
        const soloFull = soloProg.total > 0 && soloProg.counted >= soloProg.total;
        return (
          <div key={`${st.key}#${i}`} id={`walk-step-${i}`} className="scroll-mt-24 mt-3.5 first:mt-1">
            {/* ONE container per area — its spots live INSIDE it, so a spot reads as
                belonging to its area instead of floating apart. Areas are separated
                by the gap between containers; no rail threads through the content. */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              {/* Area header = the container's title bar. Solo done areas fold here. */}
              <button
                type="button"
                disabled={!(solo && done)}
                onClick={() => toggleReopen(soloBucket)}
                aria-expanded={solo && done ? soloOpen : undefined}
                className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left border-b border-gray-100 disabled:opacity-100 enabled:active:bg-gray-50"
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  done ? 'bg-green-600 text-white'
                    : isNow ? 'bg-blue-600 text-white'
                    : 'bg-white border-2 border-blue-600 text-blue-700'
                }`} aria-hidden="true">
                  {done ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[var(--fs-lg)] font-extrabold leading-tight truncate">
                  {areaName}
                  {solo && done && <span className="text-gray-400 font-bold"> {soloOpen ? '▾' : '▸'}</span>}
                </span>
                <span className="flex-shrink-0 text-[var(--fs-xs)] font-semibold text-gray-400 tabular-nums">
                  {done ? `${areaTotal} counted` : `${areaCounted} of ${areaTotal}`}
                </span>
              </button>

              {solo ? (
                (!done || soloOpen) && (
                  <div className="px-3">
                    {soloS.product_ids.map((id) => productsById[id] && (
                      <div key={id}>{renderRow(productsById[id], soloBucket)}</div>
                    ))}
                    {drawerFooter(soloS, soloFull, soloSkipped)}
                  </div>
                )
              ) : (
                st.stops.map((s, si) => {
                  const { shelf, rest } = addressOf(s);
                  const { counted, total } = stopProgress(s.bucket_id, s.product_ids);
                  const skipped = effStatus(s) === 'skipped';
                  const full = total > 0 && counted >= total;
                  // A finished (or skipped) spot folds into a quiet strip; tapping
                  // it reopens the full card.
                  const collapsed = (full || skipped) && !reopened.has(s.bucket_id);
                  const label = s.location ? typeLabel(s.location.kind) : '';
                  // Drop the type word when the name already carries it (the icon
                  // shows the kind); keep it for cryptic names like "D1".
                  const showLabel = nameIncludesType(shelf, label) ? false : !!label;
                  const active = !full && !skipped;
                  const divider = si > 0 ? 'border-t border-gray-100' : '';

                  // DONE / SKIPPED → a quiet folded strip inside the area.
                  if (collapsed) {
                    return (
                      <button key={s.bucket_id} onClick={() => toggleReopen(s.bucket_id)}
                        className={`w-full flex items-center gap-2 px-3.5 py-2.5 text-left active:opacity-70 ${divider} ${skipped ? 'bg-orange-50' : 'bg-green-50'}`}>
                        <span className={`flex-shrink-0 text-[13px] font-bold ${skipped ? 'text-orange-600' : 'text-green-600'}`} aria-hidden="true">
                          {skipped ? '⊘' : '✓'}
                        </span>
                        <span className="min-w-0 flex-1 text-[var(--fs-sm)] text-gray-600 leading-tight truncate">
                          {rest.length > 0 && <span className="text-gray-400">{rest.join(' › ')} › </span>}
                          {showLabel && <span className="text-gray-500">{label} </span>}
                          <span className="font-bold text-gray-900">{shelf}</span>
                          {' — '}{skipped ? 'skipped' : `${counted} counted`}
                        </span>
                        <span className={`flex-shrink-0 text-[var(--fs-xs)] font-bold ${skipped ? 'text-orange-600' : 'text-green-700'}`}>
                          Tap to view ▸
                        </span>
                      </button>
                    );
                  }

                  // OPEN spot → tinted heading (the lid) + its products + skip, all
                  // inside the area container.
                  return (
                    <div key={s.bucket_id} className={divider}>
                      <div className={`flex items-start gap-2 px-3.5 py-2.5 ${active ? 'bg-blue-50' : 'bg-gray-50'}`}>
                        <button onClick={() => toggleReopen(s.bucket_id)}
                          className="min-w-0 flex-1 flex items-start gap-2 text-left active:opacity-70">
                          <span className="text-[var(--fs-sm)] flex-shrink-0 mt-0.5" aria-hidden="true">
                            {s.location ? typeIcon(s.location.kind) : '📦'}
                          </span>
                          {/* Full path, never cut: ancestor trail small on top, the
                              exact spot bold underneath. */}
                          <span className="min-w-0 flex-1 leading-tight">
                            {rest.length > 0 && (
                              <span className="block text-[var(--fs-xs)] font-semibold text-gray-400 [overflow-wrap:anywhere]">{rest.join(' › ')}</span>
                            )}
                            <span className="block text-[var(--fs-sm)] font-extrabold text-gray-900 [overflow-wrap:anywhere]">
                              {showLabel && <span className="font-semibold text-gray-500">{label} </span>}{shelf}
                            </span>
                          </span>
                          <span className="flex-shrink-0 mt-0.5 flex items-center gap-1.5">
                            <span className="text-[var(--fs-xs)] font-bold text-gray-500 tabular-nums">{counted}/{total}</span>
                            {/* Opened by "Tap to view" — show the way to fold it back. */}
                            {!active && <span className="text-[var(--fs-xs)] font-bold text-green-700">Hide ▾</span>}
                          </span>
                        </button>
                        {s.bucket_id > 0 && (
                          <button onClick={() => setMapSpotId(s.bucket_id)}
                            aria-label={`Show ${shelf} on the floorplan`}
                            className="h-8 w-8 flex-shrink-0 rounded-lg border border-gray-200 bg-white text-[13px] active:scale-95">
                            🗺️
                          </button>
                        )}
                      </div>
                      <div className="px-3">
                        {s.product_ids.map((id) => productsById[id] && (
                          <div key={id}>{renderRow(productsById[id], s.bucket_id)}</div>
                        ))}
                      </div>
                      {drawerFooter(s, full, skipped)}
                    </div>
                  );
                })
              )}
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
      {mapSpotId != null && (
        <FloorplanOverlay locationId={mapSpotId} onClose={() => setMapSpotId(null)} />
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
