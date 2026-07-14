// src/app/api/rentals/inspections/route.ts
// Übergabeprotokoll — create inspection, auto-seeds items from fixed template + per-property custom items
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { INSPECTION_FIXED_TEMPLATE, Tenancy, PropertyInspectionItem } from '@/types/rentals';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const tenancyId = req.nextUrl.searchParams.get('tenancy_id');
    const propertyId = req.nextUrl.searchParams.get('property_id');

    let sql = `
      SELECT i.*,
        tn.full_name AS tenant_name,
        r.room_code, r.room_name,
        p.street, p.plz, p.city
      FROM inspections i
      JOIN tenancies t ON t.id = i.tenancy_id
      JOIN tenants tn ON tn.id = t.tenant_id
      JOIN rooms r ON r.id = i.room_id
      JOIN properties p ON p.id = i.property_id
    `;
    const where: string[] = [];
    const params: unknown[] = [];
    if (tenancyId) { where.push('i.tenancy_id = ?'); params.push(Number(tenancyId)); }
    if (propertyId) { where.push('i.property_id = ?'); params.push(Number(propertyId)); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY i.inspection_date DESC`;

    const rows = db.prepare(sql).all(...params);
    return NextResponse.json({ inspections: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenancy_id, type, inspection_date, inspector_name, notes } = body;

    if (!tenancy_id || !type || !inspection_date || !inspector_name) {
      return NextResponse.json(
        { error: 'tenancy_id, type, inspection_date, inspector_name required' },
        { status: 400 }
      );
    }
    if (type !== 'move_in' && type !== 'move_out') {
      return NextResponse.json({ error: 'type must be move_in or move_out' }, { status: 400 });
    }

    const db = getRentalsDb();
    const now = berlinNow();

    // Resolve tenancy → room → property
    const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(tenancy_id) as Tenancy | undefined;
    if (!tenancy) return NextResponse.json({ error: 'Tenancy not found' }, { status: 404 });

    const room = db.prepare(`SELECT property_id FROM rooms WHERE id = ?`).get(tenancy.room_id) as { property_id: number };

    const inspectionId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO inspections
        (tenancy_id, room_id, property_id, type, inspection_date, inspector_name,
         status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(
        tenancy_id, tenancy.room_id, room.property_id, type,
        inspection_date, inspector_name, notes ?? null, now, now
      );
      const id = Number(result.lastInsertRowid);

      // Seed items from fixed template
      const insertItem = db.prepare(`
        INSERT INTO inspection_items
        (inspection_id, category, item_label, item_order, is_custom, photo_paths_json, created_at)
        VALUES (?, ?, ?, ?, ?, '[]', ?)
      `);

      for (const cat of INSPECTION_FIXED_TEMPLATE) {
        for (const item of cat.items) {
          insertItem.run(id, cat.category, item.label, item.order, 0, now);
        }
      }

      // Seed custom per-property items
      const customItems = db.prepare(`
        SELECT * FROM property_inspection_items
        WHERE property_id = ? AND active = 1
        ORDER BY category, item_order
      `).all(room.property_id) as PropertyInspectionItem[];

      for (const c of customItems) {
        insertItem.run(id, c.category, c.item_label, c.item_order, 1, now);
      }

      return id;
    })();

    return NextResponse.json({ id: inspectionId }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
