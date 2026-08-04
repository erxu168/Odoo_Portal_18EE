/**
 * ONE WALK ACROSS SEVERAL COUNTS — the display-only answer to "don't send staff
 * to the same fridge twice".
 *
 * When a restaurant has more than one count open for today (Daily + Weekly, say),
 * merging the COUNTS into one was the dangerous idea: a new combined count is a
 * second place a product's quantity can be written from, and the whole
 * double-count risk lives there. So nothing is merged in the database.
 *
 * Instead the WALK is merged: every line from every open count is laid out in
 * one location-ordered route, and each line still belongs to its own count and
 * saves to its own ledger row. Staff walk each place once; the books are
 * untouched.
 *
 * The one case needing a rule: the SAME product appearing in two counts. It is
 * shown once and counted once — the MOST FREQUENT list claims it (daily beats
 * weekly beats monthly) and records the number; the other counts show it greyed
 * as "counted in Daily Count ✓". Staff answer once, one number is stored, and
 * neither count is left unanswerable. See claimProducts below.
 *
 * Pure functions only — no I/O — so the rules above are unit-testable.
 */

export interface WalkStopIn {
  bucket_id: number;
  location: { name: string; kind: string; photo: string | null; description: string | null } | null;
  product_ids: number[];
  status: string;
  skip_reason: string | null;
  ancestors?: { id: number; name: string; kind: string }[];
}

export interface SessionPayload {
  sessionId: number;
  /** The session row (template_name, template_frequency, status, company_id…). */
  session: Record<string, unknown> | null;
  /** Frozen lines: one per (product, spot). Empty for legacy/category counts. */
  items: { odoo_product_id: number; count_location_id: number }[];
  /** This count's guided route, if it has one. */
  stops?: WalkStopIn[];
  guided?: boolean;
}

/** A line in the combined walk: a product at a spot, and every count that wants it. */
export interface CombinedLine {
  pid: number;
  loc: number;
  /** Counts containing this exact (product, spot) — usually one. */
  sids: number[];
}

export const lineKey = (pid: number, loc: number) => `${pid}:${loc}`;

/**
 * Every distinct (product, spot) across the open counts, each remembering which
 * counts own it. A product in two counts yields ONE line with two owners.
 */
export function combineLines(payloads: SessionPayload[]): CombinedLine[] {
  const byKey = new Map<string, CombinedLine>();
  for (const p of payloads) {
    for (const it of p.items || []) {
      const key = lineKey(it.odoo_product_id, it.count_location_id);
      const found = byKey.get(key);
      if (found) {
        if (!found.sids.includes(p.sessionId)) found.sids.push(p.sessionId);
      } else {
        byKey.set(key, { pid: it.odoo_product_id, loc: it.count_location_id, sids: [p.sessionId] });
      }
    }
  }
  return Array.from(byKey.values());
}

/** Which counts a given line must be written to. */
export function ownersOf(lines: CombinedLine[], pid: number, loc: number): number[] {
  const hit = lines.find((l) => l.pid === pid && l.loc === loc);
  return hit ? hit.sids : [];
}

/**
 * ONE COUNT CLAIMS EACH PRODUCT.
 *
 * A weekly deep-count naturally repeats staples that are also on the daily list.
 * Asking staff for the same number twice is the thing we're removing, and
 * recording two independent numbers for one product is the thing that must never
 * happen. So when several of today's counts hold the same product, the MOST
 * FREQUENT list claims it (Ethan, 2026-08-03: daily beats weekly beats monthly);
 * ties go to the lower session id purely so the answer is stable.
 *
 * The claiming count records the number. The others still SHOW the product,
 * greyed, as "counted in Daily Count ✓" — nothing looks missing, the manager
 * sees the whole picture on both counts, and neither is left unanswerable.
 *
 * Claiming is by PRODUCT, not by (product, spot): a product is one thing on the
 * shelf however many spots it sits in, and its spots come from the same global
 * placements, so every count freezes the same ones.
 */
const CADENCE_RANK: Record<string, number> = { daily: 0, weekly: 1, monthly: 2, adhoc: 3 };

/** How eagerly a count claims: lower wins. Unknown cadences rank last. */
function cadenceRank(frequency: unknown): number {
  const key = typeof frequency === 'string' ? frequency : '';
  return key in CADENCE_RANK ? CADENCE_RANK[key] : 99;
}

/**
 * product id → the session that records its number.
 * Only products held by MORE THAN ONE count need an answer; a product in a
 * single count is trivially owned by it and is included for a uniform lookup.
 */
export function claimProducts(payloads: SessionPayload[]): Record<number, number> {
  const holders = new Map<number, SessionPayload[]>();
  for (const p of payloads) {
    for (const it of p.items || []) {
      const arr = holders.get(it.odoo_product_id) || [];
      if (!arr.includes(p)) arr.push(p);
      holders.set(it.odoo_product_id, arr);
    }
  }
  const claims: Record<number, number> = {};
  holders.forEach((sessions, pid) => {
    const winner = sessions.slice().sort((a, b) => {
      const byCadence = cadenceRank(a.session?.template_frequency) - cadenceRank(b.session?.template_frequency);
      return byCadence !== 0 ? byCadence : a.sessionId - b.sessionId;
    })[0];
    claims[pid] = winner.sessionId;
  });
  return claims;
}

/**
 * The ONE count that records this line's number.
 *
 * Normally the product's claimant. If that count doesn't hold this exact spot
 * (possible only if the two counts froze different placements), the number goes
 * to a count that does — a line must never be unrecordable.
 */
export function writerOf(lines: CombinedLine[], claims: Record<number, number>, pid: number, loc: number): number | null {
  const sids = ownersOf(lines, pid, loc);
  if (sids.length === 0) return null;
  const claimant = claims[pid];
  return claimant != null && sids.includes(claimant) ? claimant : sids[0];
}

/** True when this count SHOWS the line but another count records it. */
export function isCoveredElsewhere(
  lines: CombinedLine[], claims: Record<number, number>, pid: number, loc: number, sessionId: number,
): boolean {
  const writer = writerOf(lines, claims, pid, loc);
  return writer != null && writer !== sessionId && ownersOf(lines, pid, loc).includes(sessionId);
}

/**
 * One route from several. Stops are keyed by spot, so a fridge that appears in
 * two counts becomes ONE stop holding both counts' products — which is the
 * entire point. Walk order follows the first count that visited the spot, since
 * every count derives its order from the same location tree.
 */
export function combineStops(payloads: SessionPayload[]): { guided: boolean; stops: WalkStopIn[] } {
  const order: number[] = [];
  const byBucket = new Map<number, WalkStopIn>();
  for (const p of payloads) {
    for (const st of p.stops || []) {
      const found = byBucket.get(st.bucket_id);
      if (!found) {
        order.push(st.bucket_id);
        byBucket.set(st.bucket_id, { ...st, product_ids: [...st.product_ids] });
        continue;
      }
      for (const pid of st.product_ids) {
        if (!found.product_ids.includes(pid)) found.product_ids.push(pid);
      }
      // A spot counts as skipped only when EVERY count skipped it — otherwise
      // there is still work there and it must stay in the walk.
      if (found.status === 'skipped' && st.status !== 'skipped') {
        found.status = st.status;
        found.skip_reason = st.skip_reason;
      }
      // Keep whichever copy knows where the spot is.
      if ((!found.ancestors || found.ancestors.length === 0) && st.ancestors?.length) {
        found.ancestors = st.ancestors;
      }
      if (!found.location && st.location) found.location = st.location;
    }
  }
  return {
    guided: payloads.some((p) => p.guided),
    stops: order.map((b) => byBucket.get(b)!),
  };
}

/**
 * Merge per-product dictionaries (packaging chains, pack sizes, labels, system
 * quantities) from several counts. Earlier counts win on a clash: each count
 * froze its own copy, and the walk has to pick one — the first is stable and
 * they agree in practice (same product, same day, same frozen config).
 */
export function mergeByProduct<T>(dicts: (Record<number, T> | undefined | null)[]): Record<number, T> {
  const out: Record<number, T> = {};
  for (const d of dicts) {
    if (!d) continue;
    for (const k of Object.keys(d)) {
      const id = Number(k);
      if (!(id in out)) out[id] = d[id];
    }
  }
  return out;
}

/** Products from several counts, deduped by id (first wins). */
export function mergeProducts<T extends { id: number }>(lists: (T[] | undefined | null)[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const list of lists || []) {
    for (const p of list || []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/**
 * The existing counts already entered, across the counts, keyed "pid:loc".
 * When two counts hold the same line (they were answered together through this
 * screen) they agree; if they somehow differ, the one with a real quantity wins
 * over a blank, so a half-recorded pair never reads as uncounted.
 */
export function mergeEntries(
  payloads: { sessionId: number; entries?: { product_id: number; count_location_id?: number; counted_qty: number | null }[] }[],
): Record<string, { counted_qty: number | null; sid: number }> {
  const out: Record<string, { counted_qty: number | null; sid: number }> = {};
  for (const p of payloads) {
    for (const e of p.entries || []) {
      const key = lineKey(e.product_id, e.count_location_id ?? 0);
      const prev = out[key];
      if (!prev || (prev.counted_qty == null && e.counted_qty != null)) {
        out[key] = { counted_qty: e.counted_qty, sid: p.sessionId };
      }
    }
  }
  return out;
}

/** What the screen is called and what it covers, in plain words. */
export function walkTitle(payloads: SessionPayload[]): { title: string; subtitle: string } {
  const names = payloads
    .map((p) => (p.session?.template_name as string) || '')
    .filter(Boolean);
  if (payloads.length <= 1) {
    return { title: names[0] || 'Count', subtitle: '' };
  }
  return { title: 'Today’s Count', subtitle: names.join(' + ') };
}
