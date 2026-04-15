// src/app/api/rentals/meters/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const propertyId = req.nextUrl.searchParams.get('property_id');

    if (!propertyId) {
      return NextResponse.json({ error: 'property_id required' }, { status: 400 });
    }

    const meters = db.prepare(`
      SELECT m.*,
        (SELECT mr.reading_value FROM meter_readings mr
         WHERE mr.meter_id = m.id ORDER BY mr.reading_date DESC LIMIT 1) AS latest_value,
        (SELECT mr.reading_unit FROM meter_readings mr
         WHERE mr.meter_id = m.id ORDER BY mr.reading_date DESC LIMIT 1) AS latest_unit,
        (SELECT mr.reading_date FROM meter_readings mr
         WHERE mr.meter_id = m.id ORDER BY mr.reading_date DESC LIMIT 1) AS latest_date,
        (SELECT COUNT(*) FROM meter_readings mr WHERE mr.meter_id = m.id) AS readings_count
      FROM meters m
      WHERE m.property_id = ?
      ORDER BY m.meter_type, m.meter_no
    `).all(Number(propertyId));

    return NextResponse.json({ meters });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { property_id, meter_type, meter_no, location, notes } = body;

    if (!property_id || !meter_type || !meter_no) {
      return NextResponse.json({ error: 'property_id, meter_type, meter_no required' }, { status: 400 });
    }

    const validTypes = ['electricity', 'gas', 'water_cold', 'water_hot', 'heating'];
    if (!validTypes.includes(meter_type)) {
      return NextResponse.json({ error: `Invalid meter_type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    const db = getRentalsDb();
    const now = berlinNow();

    const result = db.prepare(`
      INSERT INTO meters (property_id, meter_type, meter_no, location, notes, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(property_id, meter_type, meter_no, location ?? null, notes ?? null, now, now);

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
