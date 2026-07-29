/**
 * Inventory Floorplan — the publish transaction.
 *
 * Turns a reviewed draft revision into live map data in ONE better-sqlite3
 * transaction: staged rooms become count_locations, staged spots become
 * count_locations under their room, every kept candidate becomes an anchor,
 * and the revision flips to published while the previous one is superseded.
 *
 * Fail-closed by design (Design Principle 3): any invalid coordinate, foreign
 * company, or same-room duplicate code aborts the WHOLE publish — a plan is
 * never half-published, and nothing existing is deleted (supersede, not
 * delete; archived floors keep their history).
 */
import { getDb, logAudit } from '@/lib/db';
import { initInventoryTables, createCountLocation, getCountLocation, listCountLocations } from '@/lib/inventory-db';
import { initFloorplanTables } from './db';
import { normalizeCode, polygonCentroid, validStoredPolygon } from './geometry';
import type { Pt } from './types';

export type PublishFailCode = 'not_found' | 'not_draft' | 'conflict' | 'bad_coords' | 'company_mismatch' | 'duplicate_codes' | 'unknown_room' | 'floor_archived';

export type PublishResult =
  | { ok: true; createdRooms: number; createdSpots: number; linked: number; anchors: number }
  | { ok: false; code: PublishFailCode; detail?: string };

/**
 * Failure INSIDE the transaction must THROW — better-sqlite3 only rolls back
 * on exceptions. An early `return` after the first INSERT would silently
 * COMMIT a half-published plan (this exact bug shipped to the dev seed run:
 * a duplicate-code failure left 19 rooms behind).
 */
class PublishAbort extends Error {
  constructor(public code: PublishFailCode, public detail?: string) { super(code); }
}

interface CandRow {
  id: number;
  raw_text: string;
  normalized_text: string;
  polygon: string;
  proposed_kind: string;
  disposition: string;
  linked_location_id: number | null;
  proposed_type: string | null;
  proposed_room: string | null;
}

const validPolygon = validStoredPolygon;

export function publishRevision(revisionId: number, actor: { userId: number; name: string }, expectedVersion: number): PublishResult {
  initInventoryTables();
  initFloorplanTables();
  const db = getDb();

  let result: PublishResult = { ok: false, code: 'not_found' };

  const run = db.transaction(() => {
    const rev = db.prepare('SELECT * FROM inventory_floor_revisions WHERE id = ?').get(revisionId) as
      | { id: number; floor_id: number; status: string; version: number }
      | undefined;
    if (!rev) throw new PublishAbort('not_found');
    if (rev.status !== 'draft') throw new PublishAbort('not_draft');
    if (rev.version !== expectedVersion) throw new PublishAbort('conflict');

    const floor = db.prepare('SELECT * FROM inventory_floors WHERE id = ?').get(rev.floor_id) as
      | { id: number; company_id: number; current_revision_id: number | null }
      | undefined;
    if (!floor) throw new PublishAbort('not_found');
    if (!(floor as { active?: number }).active) throw new PublishAbort('floor_archived');
    const companyId = floor.company_id;

    const kept = (db.prepare(
      "SELECT * FROM inventory_floor_candidates WHERE revision_id = ? AND disposition IN ('create','linked') ORDER BY item_index",
    ).all(revisionId) as CandRow[]);

    // ---- validate every kept polygon ----------------------------------------
    const polys = new Map<number, Pt[]>();
    for (const c of kept) {
      let poly: unknown;
      try { poly = JSON.parse(c.polygon); } catch { poly = null; }
      if (!validPolygon(poly)) {
        throw new PublishAbort('bad_coords', `"${c.raw_text}" has an invalid position`);
      }
      polys.set(c.id, poly);
    }

    // ---- validate linked locations belong to this company -------------------
    for (const c of kept.filter(k => k.disposition === 'linked')) {
      const loc = c.linked_location_id ? getCountLocation(c.linked_location_id) : null;
      if (!loc || loc.company_id !== companyId) {
        throw new PublishAbort('company_mismatch', `"${c.raw_text}" links to a spot outside this restaurant`);
      }
      if (!(loc as { active?: boolean | number }).active) {
        throw new PublishAbort('company_mismatch', `"${c.raw_text}" links to an archived spot`);
      }
    }

    // ---- resolve rooms: staged creations first, then existing by name -------
    const existing = listCountLocations(companyId) as Array<{ id: number; name: string; parent_id: number | null; kind: string }>;
    // Only room-like locations may be matched by NAME — a spot that happens to
    // be called "FREEZER" must never become a parent (Codex finding #8).
    const ROOMISH = new Set(['room', 'area', 'floor']);
    const existingByName = new Map(existing.filter(l => ROOMISH.has(l.kind)).map(l => [normalizeCode(l.name), l]));
    const roomIds = new Map<string, number>(); // normalized room name -> location id
    let createdRooms = 0;

    const roomCands = kept.filter(k => k.proposed_kind === 'room' && k.disposition === 'create');
    for (const c of roomCands) {
      const label = c.raw_text.trim();
      const key = normalizeCode(label);
      if (roomIds.has(key)) throw new PublishAbort('duplicate_codes', `Room "${label}" appears twice`);
      const already = existingByName.get(key);
      if (already) {
        roomIds.set(key, already.id); // room already exists → reuse, don't duplicate
      } else {
        const id = createCountLocation({
          parent_id: null, company_id: companyId, name: label, kind: 'room',
          description: null, photo: null, odoo_location_id: null, created_by: actor.userId,
        });
        roomIds.set(key, id);
        createdRooms += 1;
      }
    }
    const linkedRoomCands = kept.filter(k => k.proposed_kind === 'room' && k.disposition === 'linked');
    for (const c of linkedRoomCands) roomIds.set(normalizeCode(c.raw_text), c.linked_location_id as number);

    // A named room MUST resolve — silently creating the spot at the root would
    // scatter orphans across the tree. No room named at all stays allowed
    // (utility points like the fuse box live outside rooms by design).
    const resolveRoom = (c: CandRow): number | null => {
      const name = c.proposed_room;
      if (!name || !name.trim()) return null;
      const key = normalizeCode(name);
      if (roomIds.has(key)) return roomIds.get(key)!;
      const found = existingByName.get(key);
      if (found) return found.id;
      throw new PublishAbort('unknown_room', `"${c.raw_text}" is assigned to room "${name}", which is neither on this plan nor an existing room`);
    };

    // ---- spots: same-room duplicate codes are a publish blocker -------------
    const spotCands = kept.filter(k => k.proposed_kind === 'spot');
    const childrenByParent = new Map<number | null, Set<string>>();
    for (const l of existing) {
      if (!childrenByParent.has(l.parent_id)) childrenByParent.set(l.parent_id, new Set());
      childrenByParent.get(l.parent_id)!.add(normalizeCode(l.name));
    }
    const claimed = new Map<string, string>(); // `${roomId}|${code}` -> raw text

    let createdSpots = 0;
    let linked = 0;
    let anchors = 0;

    const existingChild = (roomId: number | null, code: string): number | null => {
      const hit = existing.find(l => l.parent_id === roomId && normalizeCode(l.name) === code);
      return hit ? hit.id : null;
    };

    const spotPlan: Array<{ cand: CandRow; roomId: number | null; locationId: number | null }> = [];
    const linkedTargets = new Set<number>();
    for (const c of spotCands) {
      const code = normalizeCode(c.normalized_text || c.raw_text);
      if (c.disposition === 'linked') {
        const target = c.linked_location_id as number;
        if (linkedTargets.has(target)) {
          throw new PublishAbort('duplicate_codes', `Two labels link to the same spot ("${c.raw_text}") — untick one or link it elsewhere`);
        }
        linkedTargets.add(target);
        spotPlan.push({ cand: c, roomId: null, locationId: target });
        continue;
      }
      const roomId = resolveRoom(c);
      const dupKey = `${roomId ?? 'none'}|${code}`;
      if (claimed.has(dupKey)) {
        throw new PublishAbort('duplicate_codes', `"${code}" appears twice in the same room — rename or untick one`);
      }
      claimed.set(dupKey, c.raw_text);
      // Same code in the same room ALREADY exists → that IS this spot: link to
      // it instead of failing or duplicating, so re-uploading plan v1.4 keeps
      // every product placement. (Identity = room + code, per the owner's
      // naming system; the same code in ANOTHER room is a different spot.)
      const already = roomId !== null ? existingChild(roomId, code) : null;
      if (already !== null) {
        if (linkedTargets.has(already)) {
          throw new PublishAbort('duplicate_codes', `Two labels resolve to the same existing spot ("${code}")`);
        }
        linkedTargets.add(already);
      }
      spotPlan.push({ cand: c, roomId, locationId: already });
    }

    for (const p of spotPlan) {
      if (p.locationId === null) {
        p.locationId = createCountLocation({
          parent_id: p.roomId, company_id: companyId,
          name: normalizeCode(p.cand.normalized_text || p.cand.raw_text),
          kind: p.cand.proposed_type || 'area',
          description: null, photo: null, odoo_location_id: null, created_by: actor.userId,
        });
        createdSpots += 1;
      } else {
        linked += 1;
      }
    }

    // ---- anchors: rooms + spots ---------------------------------------------
    const insertAnchor = db.prepare(
      `INSERT INTO inventory_floor_anchors
         (revision_id, count_location_id, source_candidate_id, polygon, cx, cy, label, display, is_primary, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
    );
    const now = new Date().toISOString();
    for (const c of [...roomCands, ...linkedRoomCands]) {
      const locId = roomIds.get(normalizeCode(c.raw_text))!;
      const poly = polys.get(c.id)!;
      const ctr = polygonCentroid(poly);
      insertAnchor.run(revisionId, locId, c.id, JSON.stringify(poly), ctr.x, ctr.y, c.raw_text.trim(), 'overlay', actor.userId, now);
      anchors += 1;
    }
    for (const p of spotPlan) {
      const poly = polys.get(p.cand.id)!;
      const ctr = polygonCentroid(poly);
      insertAnchor.run(
        revisionId, p.locationId, p.cand.id, JSON.stringify(poly), ctr.x, ctr.y,
        normalizeCode(p.cand.normalized_text || p.cand.raw_text), 'overlay', actor.userId, now,
      );
      anchors += 1;
    }

    // ---- flip statuses -------------------------------------------------------
    db.prepare(
      "UPDATE inventory_floor_revisions SET status='superseded' WHERE floor_id = ? AND status = 'published'",
    ).run(floor.id);
    db.prepare(
      "UPDATE inventory_floor_revisions SET status='published', version = version + 1, published_by = ?, published_at = ? WHERE id = ?",
    ).run(actor.userId, now, revisionId);
    db.prepare('UPDATE inventory_floors SET current_revision_id = ?, updated_at = ? WHERE id = ?')
      .run(revisionId, now, floor.id);

    logAudit({
      user_id: actor.userId, user_name: actor.name, action: 'floorplan.publish', module: 'inventory',
      target_type: 'floor_revision', target_id: revisionId,
      detail: JSON.stringify({ createdRooms, createdSpots, linked, anchors }),
    });

    result = { ok: true, createdRooms, createdSpots, linked, anchors };
  });

  try {
    run();
  } catch (e: unknown) {
    if (e instanceof PublishAbort) return { ok: false, code: e.code, detail: e.detail };
    throw e;
  }
  return result;
}
