// src/app/api/rentals/rooms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const propertyId = req.nextUrl.searchParams.get('property_id');

    let rows;
    if (propertyId) {
      rows = db.prepare(`
        SELECT r.*,
          (SELECT t.id FROM tenancies t WHERE t.room_id = r.id AND t.status = 'active' LIMIT 1) AS active_tenancy_id,
          (SELECT tn.full_name FROM tenancies t
           JOIN tenants tn ON tn.id = t.tenant_id
           WHERE t.room_id = r.id AND t.status = 'active' LIMIT 1) AS active_tenant_name
        FROM rooms r WHERE r.property_id = ? ORDER BY r.room_code
      `).all(Number(propertyId));
    } else {
      rows = db.prepare(`SELECT * FROM rooms ORDER BY property_id, room_code`).all();
    }
    return NextResponse.json({ rooms: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { property_id, room_code, room_name, size_sqm, base_kaltmiete, utility_share, notes } = body;

    if (!property_id || !room_code || size_sqm === undefined) {
      return NextResponse.json({ error: 'property_id, room_code, size_sqm required' }, { status: 400 });
    }

    const db = getRentalsDb();
    const now = berlinNow();
    const result = db.prepare(`
      INSERT INTO rooms (property_id, room_code, room_name, size_sqm, base_kaltmiete, utility_share, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'vacant', ?, ?, ?)
    `).run(
      property_id, room_code, room_name ?? null, size_sqm,
      base_kaltmiete ?? 0, utility_share ?? 0, notes ?? null, now, now
    );
    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
