// src/app/api/rentals/meters/[id]/readings/route.ts
// Meter readings with photo upload
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow, berlinToday } from '@/lib/rentals-db';
import fs from 'fs';
import path from 'path';

const PHOTO_DIR = path.join(process.env.PORTAL_DB_DIR || path.join(process.cwd(), 'data'), 'rentals', 'photos', 'meters');

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const meterId = Number(params.id);

    const readings = db.prepare(`
      SELECT * FROM meter_readings WHERE meter_id = ? ORDER BY reading_date DESC
    `).all(meterId);

    return NextResponse.json({ readings });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const meterId = Number(params.id);
    const now = berlinNow();

    // Look up the meter to get property_id, meter_type, meter_no
    const meter = db.prepare(`SELECT * FROM meters WHERE id = ?`).get(meterId) as {
      id: number; property_id: number; meter_type: string; meter_no: string;
    } | undefined;
    if (!meter) return NextResponse.json({ error: 'Meter not found' }, { status: 404 });

    const formData = await req.formData();
    const readingValue = formData.get('reading_value');
    const readingUnit = formData.get('reading_unit') as string || 'kWh';
    const readingDate = formData.get('reading_date') as string || berlinToday();
    const notes = formData.get('notes') as string || null;
    const photo = formData.get('photo') as File | null;

    if (!readingValue) {
      return NextResponse.json({ error: 'reading_value required' }, { status: 400 });
    }

    let photoPath: string | null = null;

    if (photo && photo.size > 0) {
      // Ensure photo directory exists
      if (!fs.existsSync(PHOTO_DIR)) {
        fs.mkdirSync(PHOTO_DIR, { recursive: true });
      }

      const ext = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filename = `${meterId}_${Date.now()}.${ext}`;
      const filePath = path.join(PHOTO_DIR, filename);

      const buffer = Buffer.from(await photo.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      photoPath = `meters/${filename}`;
    }

    const result = db.prepare(`
      INSERT INTO meter_readings
      (property_id, meter_id, meter_type, meter_no, reading_value, reading_unit, reading_date, photo_path, source, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
    `).run(
      meter.property_id, meterId, meter.meter_type, meter.meter_no,
      Number(readingValue), readingUnit, readingDate, photoPath,
      notes, now
    );

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
