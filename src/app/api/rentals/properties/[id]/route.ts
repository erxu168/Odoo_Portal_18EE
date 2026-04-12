// src/app/api/rentals/properties/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Property } from '@/types/rentals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(id) as Property | undefined;
    if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const rooms = db.prepare(`SELECT * FROM rooms WHERE property_id = ? ORDER BY room_code`).all(id);
    const utilities = db.prepare(`SELECT * FROM utility_providers WHERE property_id = ? ORDER BY category`).all(id);
    const recycling = db.prepare(`SELECT * FROM recycling_containers WHERE property_id = ?`).all(id);
    const meters = db.prepare(`
      SELECT * FROM meter_readings WHERE property_id = ?
      ORDER BY reading_date DESC LIMIT 20
    `).all(id);

    return NextResponse.json({ property, rooms, utilities, recycling, meters });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const body = await req.json();
    const now = berlinNow();

    const fields = [
      'street', 'plz', 'city', 'floor_unit', 'type', 'total_size_sqm',
      'owner', 'hausverwaltung', 'mietspiegel_eur_per_sqm', 'notes',
    ];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    }
    if (body.mietspiegel_eur_per_sqm !== undefined) {
      updates.push(`mietspiegel_updated_at = ?`);
      values.push(now);
    }
    if (updates.length === 0) return NextResponse.json({ updated: 0 });

    updates.push(`updated_at = ?`);
    values.push(now);
    values.push(id);

    const result = db.prepare(`UPDATE properties SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const result = db.prepare(`DELETE FROM properties WHERE id = ?`).run(id);
    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
