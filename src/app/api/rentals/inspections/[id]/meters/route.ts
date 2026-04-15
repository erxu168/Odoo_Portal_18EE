// src/app/api/rentals/inspections/[id]/meters/route.ts
// Record meter readings during an inspection
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Inspection } from '@/types/rentals';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const inspectionId = Number(params.id);
    const body = await req.json();
    const { meter_type, meter_no, reading_value, reading_unit, photo_path, notes } = body;

    if (!meter_type || !meter_no || reading_value === undefined || !reading_unit) {
      return NextResponse.json(
        { error: 'meter_type, meter_no, reading_value, reading_unit required' },
        { status: 400 }
      );
    }

    const inspection = db.prepare(`SELECT * FROM inspections WHERE id = ?`).get(inspectionId) as Inspection | undefined;
    if (!inspection) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });

    const now = berlinNow();
    const result = db.prepare(`
      INSERT INTO meter_readings
      (property_id, meter_type, meter_no, reading_value, reading_unit, reading_date,
       photo_path, source, inspection_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inspection', ?, ?, ?)
    `).run(
      inspection.property_id, meter_type, meter_no, reading_value, reading_unit,
      inspection.inspection_date, photo_path ?? null, inspectionId, notes ?? null, now
    );

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
