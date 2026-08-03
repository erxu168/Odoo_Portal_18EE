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
 * The one case needing a rule: the SAME product at the SAME spot appearing in
 * two counts. It is shown once (asking twice is the very thing we're removing),
 * and the number entered is written to BOTH counts. That is safe because it is
 * one observation recorded in two places — approval sets stock to that value, so
 * applying it twice lands on the same number, and neither count is left
 * unanswerable. Two INDEPENDENT counts of one product is what must never happen,
 * and that is exactly what this prevents.
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
