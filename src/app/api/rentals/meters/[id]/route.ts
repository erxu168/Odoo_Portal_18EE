// src/app/api/rentals/meters/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);

    const meter = db.prepare(`SELECT * FROM meters WHERE id = ?`).get(id);
    if (!meter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const readings = db.prepare(`
      SELECT * FROM meter_readings WHERE meter_id = ? ORDER BY reading_date DESC
    `).all(id);

    const property = db.prepare(`SELECT street, plz, city FROM properties WHERE id = ?`)
      .get((meter as { property_id: number }).property_id);

    return NextResponse.json({ meter, readings, property });
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

    const fields = ['meter_type', 'meter_no', 'location', 'notes', 'active'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }
    if (updates.length === 0) return NextResponse.json({ updated: 0 });

    updates.push(`updated_at = ?`);
    values.push(now);
    values.push(id);

    const result = db.prepare(`UPDATE meters SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const result = db.prepare(`DELETE FROM meters WHERE id = ?`).run(Number(params.id));
    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
