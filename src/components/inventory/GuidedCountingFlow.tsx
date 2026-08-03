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
 * counted in place. Nothing ever opens or shuts: a finished spot stays exactly
 * where it is, its header simply gains a tick, and a counted product fades in
 * place while staying tappable. The page only moves when a person scrolls it.
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
  /** How many of a stop's lines are counted — drives every progress reading on the page. */
  stopProgress: (bucketId: number, productIds: number[]) => { counted: number; total: number };
  onSkipStop: (bucketId: number, reason: string) => void;
  /** Take back a skip — the place gets counted after all. */
  onUnskipStop: (bucketId: number) => void;
  onReview: () => void;
}

// Fallback until the managed list loads (same defaults seeded server-side).
const DEFAULT_REASONS = ['Location was locked', 'Ran out of time', 'Nothing stored here today', 'Already counted earlier'];

type UnitInfo = { id: number; name: string; kind: string };
type Grp = { key: string; unit: UnitInfo | null; between: string[]; own: Stop | null; stops: Stop[] };

/**
 * Group an area's stops the way a person walks them: consecutive stops sharing
 * the same immediate parent (the fridge they live in) become ONE unit group, so
 * the fridge is named once and its drawers hang beneath it.
 *
 * A unit holding exactly ONE stop and nothing of its own is folded back to a
 * plain stop — there the heading costs a whole band to repeat what the stop's
 * own trail already says.
 */
function buildGroups(stops: Stop[]): Grp[] {
  const grps: Grp[] = [];
  stops.forEach((s) => {
    const anc = s.ancestors || [];
    if (anc.length >= 2) {
      const unit = anc[anc.length - 1];
      const prev = grps[grps.length - 1];
      if (prev?.unit && prev.unit.id === unit.id) { prev.stops.push(s); return; }
      // Products placed ON the unit itself: DFS emits the unit's own stop right
      // before its children — fold it in so the unit is never named twice.
      if (prev && !prev.unit && prev.stops.length === 1 && prev.stops[0].bucket_id === unit.id) {
        grps[grps.length - 1] = { key: `unit-${unit.id}-${prev.stops[0].bucket_id}`, unit, between: anc.slice(1, -1).map((a) => a.name), own: prev.stops[0], stops: [s] };
        return;
      }
      grps.push({ key: `unit-${unit.id}-${s.bucket_id}`, unit, between: anc.slice(1, -1).map((a) => a.name), own: null, stops: [s] });
    } else {
      grps.push({ key: `plain-${s.bucket_id}`, unit: null, between: [], own: null, stops: [s] });
    }
  });
  return grps.map((g) => (g.unit && !g.own && g.stops.length === 1
    ? { key: `plain-${g.stops[0].bucket_id}`, unit: null, between: [], own: null, stops: g.stops }
    : g));
}

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

  // The skip / un-skip action for a drawer — it lives INSIDE that drawer's card,
  // so there's never a question of which spot a floating "Nothing here" belongs to.
  const drawerFooter = (s: Stop, full: boolean, skipped: boolean) => {
    // The reason as SAVED with the route, unless this session just changed it.
    // Reading only the live override lost the reason on a reopened count — the
    // stop still read "skipped" with nothing to say why (Codex, 2026-08-03).
    const reason = statuses[s.bucket_id]?.skip_reason ?? s.skip_reason;
    return skipped ? (
      <div className="flex items-center gap-2 text-[var(--fs-xs)] text-orange-700 bg-orange-50 px-3 py-2 border-t border-orange-100">
        <span className="min-w-0">
          Skipped{reason ? ` — ${reason}` : ''}
        </span>
        <button onClick={() => onUnskipStop(s.bucket_id)}
          className="ml-auto flex-shrink-0 font-bold underline active:opacity-60">
          Count it after all
        </button>
      </div>
    ) : !full ? (
      <button onClick={() => setSkipFor(s.bucket_id)}
        className="w-full text-right text-[var(--fs-xs)] font-bold text-gray-400 px-3 py-2 border-t border-gray-100 bg-white active:text-gray-600 whitespace-nowrap overflow-hidden text-ellipsis">
        Nothing in this drawer {'→'}
      </button>
    ) : (
      // Finishing the last product here must NOT make this line vanish —
      // dropping it would shift the whole page up, the very jump we removed
      // (Codex, 2026-08-03). The slot keeps its exact height instead and says
      // the spot is done. Both versions are ONE line, kept short and pinned
      // with whitespace-nowrap: a wrap on a 320px phone would change the
      // height and reintroduce the very shift this exists to prevent.
      <div className="w-full text-right text-[var(--fs-xs)] font-bold text-green-700 px-3 py-2 border-t border-gray-100 bg-white whitespace-nowrap overflow-hidden text-ellipsis">
        ✓ All counted here
      </div>
    );
  };

  // NOTHING ON THIS PAGE COLLAPSES ITSELF (Ethan, 2026-08-03: "the screen starts
  // to move because the list collapses for that location"). A finished spot stays
  // open exactly where it is and simply reads as finished; a counted product row
  // dims in place and stays tappable, so a wrong number is corrected by tapping
  // it again. Nothing above the thumb is ever removed, so the page cannot shift
  // under a moving finger. Don't reintroduce auto-folding — and don't add a
  // hand-rolled scrollBy either: one here fought the browser's native scroll
  // anchoring and threw the page to the top (measured 400 -> 0).
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
        // directly under it — no second heading.
        const solo = st.stops.length === 1 && !st.room;
        const soloBucket = st.stops[0].bucket_id;
        // Area totals for the section header count. Skipped spots are tracked
        // separately: a step counts as DONE once every spot is either counted
        // or skipped, so "done" must never be reported as "all counted" — an
        // area that was skipped outright had nothing counted at all (Codex,
        // 2026-08-03).
        const areaTotal = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).total, 0);
        const areaCounted = st.stops.reduce((a, s) => a + stopProgress(s.bucket_id, s.product_ids).counted, 0);
        const areaSkipped = st.stops.filter((s) => effStatus(s) === 'skipped').length;
        const areaAllSkipped = areaSkipped > 0 && areaSkipped === st.stops.length;
        const soloLoc = st.stops[0].location;
        const areaName = st.room || (soloLoc
          ? (nameIncludesType(soloLoc.name, typeLabel(soloLoc.kind)) ? soloLoc.name : `${typeLabel(soloLoc.kind)} ${soloLoc.name}`)
          : 'Not in a place yet');
        // When a room holds exactly ONE container, the room band and the
        // container band say one thing between them — so they become one
        // breadcrumb line: "① WAJ Kitchen › 🧊 Countertop fridge". A room with
        // several containers keeps them separate; there the grouping earns its
        // space (Ethan, 2026-08-03).
        const groups = buildGroups(st.stops);
        const loneUnit = !solo && groups.length === 1 && groups[0].unit ? groups[0] : null;
        // The merged header must CARRY the container's affordances, not drop
        // them: its own progress and its map button.
        const luMembers = loneUnit ? (loneUnit.own ? [loneUnit.own, ...loneUnit.stops] : loneUnit.stops) : [];
        const luDone = luMembers.filter((m) => {
          const pr = stopProgress(m.bucket_id, m.product_ids);
          return effStatus(m) === 'skipped' || (pr.total > 0 && pr.counted >= pr.total);
        }).length;
        const luAllDone = luMembers.length > 0 && luDone === luMembers.length;
        const luLabel = loneUnit ? typeLabel(loneUnit.unit!.kind) : '';
        const luShowLabel = !!loneUnit && !!luLabel && !nameIncludesType(loneUnit.unit!.name, luLabel);
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
              {/* Area header = the container's title bar. It states where you are
                  and how far along — it is not a door, because nothing here
                  opens or shuts any more. */}
              <div className="w-full flex items-center gap-2.5 px-3.5 py-3 border-b border-gray-100">
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                    done ? 'bg-green-600 text-white'
                      : isNow ? 'bg-blue-600 text-white'
                      : 'bg-white border-2 border-blue-600 text-blue-700'
                  }`} aria-hidden="true">
                    {done ? '✓' : i + 1}
                  </span>
                  {/* THE CONTAINER IS THE DESTINATION, so it is the loud line and
                      the room is the quiet trail above it. The first version had
                      this the wrong way round and truncated the name that
                      matters ("Countertop f…") — Ethan, 2026-08-03. Nothing
                      truncates now: a long name wraps rather than hiding. */}
                  <span className="min-w-0 flex-1 leading-tight">
                    {loneUnit ? (
                      <>
                        <span className="block text-[var(--fs-xs)] font-semibold text-gray-400 truncate">
                          {areaName}
                          {loneUnit.between.length > 0 && <> {'›'} {loneUnit.between.join(' › ')}</>}
                        </span>
                        <span className="block text-[var(--fs-lg)] font-extrabold [overflow-wrap:anywhere]">
                          <span aria-hidden="true">{typeIcon(loneUnit.unit!.kind)} </span>
                          {/* the type word matters for a cryptic name — "Fridge F1", not "F1" */}
                          {luShowLabel && <span className="font-semibold text-gray-500">{luLabel} </span>}
                          {loneUnit.unit!.name}
                        </span>
                      </>
                    ) : (
                      <span className="block text-[var(--fs-lg)] font-extrabold [overflow-wrap:anywhere]">
                        {areaName}
                      </span>
                    )}
                  </span>
                </div>
                <span className={`flex-shrink-0 text-[var(--fs-xs)] font-semibold tabular-nums whitespace-nowrap ${
                  areaAllSkipped ? 'text-orange-700'
                    : (loneUnit ? luAllDone : done) ? 'text-green-700' : 'text-gray-400'
                }`}>
                  {/* Skipped outright is checked FIRST, whichever shape the
                      header takes: a merged room+container header must not
                      report "3/3" for three places nobody counted. */}
                  {areaAllSkipped ? '⊘ skipped' : loneUnit ? (
                    <>
                      {/* compact on screen, a sentence for a screen reader —
                          "2/3" alone announces as "two slash three". */}
                      <span aria-hidden="true">{luAllDone && '✓ '}{luDone}/{luMembers.length}</span>
                      <span className="sr-only">{luDone} of {luMembers.length} places done</span>
                      {areaSkipped > 0 && <span className="text-orange-700"> · {areaSkipped} skipped</span>}
                    </>
                  ) : done ? `✓ ${areaCounted} counted${areaSkipped > 0 ? ` · ${areaSkipped} skipped` : ''}`
                    : `${areaCounted} of ${areaTotal}`}
                </span>
                {loneUnit && (
                  <button onClick={() => setMapSpotId(loneUnit.unit!.id)}
                    aria-label={`Show ${loneUnit.unit!.name} on the floorplan`}
                    className="h-8 w-8 flex-shrink-0 rounded-lg border border-gray-200 bg-white text-[13px] active:scale-95">
                    🗺️
                  </button>
                )}
              </div>

              {solo ? (
                <div className="px-3">
                  {soloS.product_ids.map((id) => productsById[id] && (
                    <div key={id}>{renderRow(productsById[id], soloBucket)}</div>
                  ))}
                  {drawerFooter(soloS, soloFull, soloSkipped)}
                </div>
              ) : (
                (() => {
                  const grps = groups;
                  const stopBits = (s: Stop) => {
                    const { counted, total } = stopProgress(s.bucket_id, s.product_ids);
                    const skipped = effStatus(s) === 'skipped';
                    return { counted, total, skipped, full: total > 0 && counted >= total };
                  };

                  // One stop: its lid, then its products — always both. A finished
                  // spot keeps its full height and just reads as finished, so the
                  // page never reflows under a thumb. Inside a unit the trail is
                  // dropped (the heading above already said where we are) and the
                  // lid indents; product rows keep full width.
                  const renderStop = (s: Stop, inUnit: boolean, topBorder: boolean) => {
                    const { shelf, rest } = addressOf(s);
                    const { counted, total, skipped, full } = stopBits(s);
                    const label = s.location ? typeLabel(s.location.kind) : '';
                    const showLabel = nameIncludesType(shelf, label) ? false : !!label;
                    const divider = topBorder ? 'border-t border-gray-100' : '';
                    const indent = inUnit ? 'pl-7' : '';
                    // Icon + colour + words, never colour alone.
                    const lidTint = skipped ? 'bg-orange-50' : full ? 'bg-green-50' : 'bg-blue-50';

                    return (
                      <div key={s.bucket_id} className={divider}>
                        <div className={['flex items-start gap-2 px-3.5 py-2.5', indent, lidTint].filter(Boolean).join(' ')}>
                          <div className="min-w-0 flex-1 flex items-start gap-2">
                            <span className="text-[var(--fs-sm)] flex-shrink-0 mt-0.5" aria-hidden="true">
                              {s.location ? typeIcon(s.location.kind) : '📦'}
                            </span>
                            <span className="min-w-0 flex-1 leading-tight">
                              {/* Outside a unit the full trail still prints — never
                                  cut; inside one, the heading already carries it. */}
                              {!inUnit && rest.length > 0 && (
                                <span className="block text-[var(--fs-xs)] font-semibold text-gray-400 [overflow-wrap:anywhere]">{rest.join(' › ')}</span>
                              )}
                              <span className="block text-[var(--fs-sm)] font-extrabold text-gray-900 [overflow-wrap:anywhere]">
                                {showLabel && <span className="font-semibold text-gray-500">{label} </span>}{shelf}
                              </span>
                            </span>
                            <span className={`flex-shrink-0 mt-0.5 text-[var(--fs-xs)] font-bold tabular-nums ${
                              skipped ? 'text-orange-700' : full ? 'text-green-700' : 'text-gray-500'
                            }`}>
                              {skipped ? (
                                <span>⊘ skipped</span>
                              ) : (
                                <>
                                  {/* "3/3" alone announces as "three slash three". */}
                                  <span aria-hidden="true">{full && '✓ '}{counted}/{total}</span>
                                  <span className="sr-only">{counted} of {total} counted{full ? ' — done' : ''}</span>
                                </>
                              )}
                            </span>
                          </div>
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
                  };

                  return grps.map((g, gi) => {
                    if (!g.unit) return renderStop(g.stops[0], false, gi > 0);

                    // The area header ALREADY names this container (a room with
                    // exactly one of them merges the two lines), so drawing the
                    // heading again would be the very stack we removed.
                    if (loneUnit && g.key === loneUnit.key) {
                      const members2 = g.own ? [g.own, ...g.stops] : g.stops;
                      const ob = g.own ? stopBits(g.own) : null;
                      return (
                        <div key={g.key}>
                          {g.own && ob && (
                            <>
                              <div className="px-3">
                                {g.own.product_ids.map((id) => productsById[id] && (
                                  <div key={id}>{renderRow(productsById[id], g.own!.bucket_id)}</div>
                                ))}
                              </div>
                              {drawerFooter(g.own, ob.full, ob.skipped)}
                            </>
                          )}
                          {g.stops.map((st2, si) => renderStop(st2, true, si > 0 || !!g.own))}
                          {members2.length === 0 && null}
                        </div>
                      );
                    }

                    const members = g.own ? [g.own, ...g.stops] : g.stops;
                    const bits = members.map(stopBits);
                    const doneCount = bits.filter((b) => b.full || b.skipped).length;
                    const skippedCount = bits.filter((b) => b.skipped).length;
                    const allDone = doneCount === members.length && members.length > 0;
                    const uLabel = typeLabel(g.unit.kind);
                    const showULabel = nameIncludesType(g.unit.name, uLabel) ? false : !!uLabel;
                    // Heavier rule between unit groups than between drawers.
                    const divider = gi > 0 ? 'border-t border-gray-200' : '';
                    const ownBits = g.own ? stopBits(g.own) : null;

                    return (
                      <div key={g.key} className={divider}>
                        {/* The unit heading — the fridge is named ONCE here; the
                            in-between chain prints once too, never per drawer. */}
                        <div className="px-3.5 pt-3 pb-2">
                          {g.between.length > 0 && (
                            <div className="text-[var(--fs-xs)] font-semibold text-gray-400 [overflow-wrap:anywhere] mb-0.5">{g.between.join(' › ')} ›</div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 text-[var(--fs-sm)] font-extrabold text-gray-900 [overflow-wrap:anywhere]">
                              <span aria-hidden="true">{typeIcon(g.unit.kind)} </span>
                              {showULabel && <span className="font-semibold text-gray-500">{uLabel} </span>}{g.unit.name}
                            </span>
                            <span className={`flex-shrink-0 text-[var(--fs-xs)] font-bold tabular-nums ${allDone ? 'text-green-700' : 'text-gray-500'}`}>
                              <span aria-hidden="true">{allDone && '✓ '}</span>{doneCount} of {members.length} done
                              {skippedCount > 0 && <span className="text-orange-700"> · {skippedCount} skipped</span>}
                            </span>
                            <button onClick={() => setMapSpotId(g.unit!.id)}
                              aria-label={`Show ${g.unit.name} on the floorplan`}
                              className="h-8 w-8 flex-shrink-0 rounded-lg border border-gray-200 bg-white text-[13px] active:scale-95">
                              🗺️
                            </button>
                          </div>
                        </div>
                        {/* Products stored on the unit itself, before its drawers. */}
                        {g.own && ownBits && (
                          <>
                            <div className="px-3">
                              {g.own.product_ids.map((id) => productsById[id] && (
                                <div key={id}>{renderRow(productsById[id], g.own!.bucket_id)}</div>
                              ))}
                            </div>
                            {drawerFooter(g.own, ownBits.full, ownBits.skipped)}
                          </>
                        )}
                        {g.stops.map((s) => renderStop(s, true, true))}
                      </div>
                    );
                  });
                })()
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
          Every item needs an answer {'—'} a count, {'“'}out of stock{'”'} or {'“'}couldn{'’'}t find it{'”'} {'—'} before you can submit.
          {' '}Got one wrong? Tap its number again {'—'} nothing here closes or disappears.
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
