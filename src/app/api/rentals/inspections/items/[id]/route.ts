// src/app/api/rentals/inspections/items/[id]/route.ts
// Update a single inspection item — condition, notes, photos
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb } from '@/lib/rentals-db';
import { InspectionItem } from '@/types/rentals';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const body = await req.json();

    const current = db.prepare(`SELECT * FROM inspection_items WHERE id = ?`).get(id) as InspectionItem | undefined;
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const fields = ['condition', 'notes'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }

    // Photo path append/replace
    if (body.photo_paths !== undefined) {
      if (!Array.isArray(body.photo_paths)) {
        return NextResponse.json({ error: 'photo_paths must be an array' }, { status: 400 });
      }
      updates.push('photo_paths_json = ?');
      values.push(JSON.stringify(body.photo_paths));
    }

    if (updates.length === 0) return NextResponse.json({ updated: 0 });
    values.push(id);

    const result = db.prepare(`UPDATE inspection_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
