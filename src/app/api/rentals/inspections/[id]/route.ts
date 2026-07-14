// src/app/api/rentals/inspections/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Inspection, InspectionItem, MeterReading, Tenancy, Room, Property, Tenant } from '@/types/rentals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);

    const inspection = db.prepare(`SELECT * FROM inspections WHERE id = ?`).get(id) as Inspection | undefined;
    if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = db.prepare(`
      SELECT * FROM inspection_items WHERE inspection_id = ?
      ORDER BY category, item_order
    `).all(id) as InspectionItem[];

    const meters = db.prepare(`
      SELECT * FROM meter_readings WHERE inspection_id = ?
      ORDER BY meter_type
    `).all(id) as MeterReading[];

    const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(inspection.tenancy_id) as Tenancy;
    const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenancy.tenant_id) as Tenant;
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(inspection.room_id) as Room;
    const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(inspection.property_id) as Property;

    // Group items by category
    const byCategory: Record<string, InspectionItem[]> = {};
    for (const item of items) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }

    // Summary counts
    const summary = items.reduce(
      (acc, i) => {
        if (i.condition === 'neuwertig') acc.neuwertig++;
        else if (i.condition === 'gut') acc.gut++;
        else if (i.condition === 'gebrauchsspuren') acc.gebrauchsspuren++;
        else if (i.condition === 'beschaedigt') acc.beschaedigt++;
        else acc.pending++;
        return acc;
      },
      { neuwertig: 0, gut: 0, gebrauchsspuren: 0, beschaedigt: 0, pending: 0 }
    );

    return NextResponse.json({
      inspection, items, byCategory, meters, tenant, tenancy, room, property, summary,
    });
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

    const fields = ['status', 'inspection_date', 'inspector_name', 'notes',
                    'tenant_signature_path', 'landlord_signature_path',
                    'tenant_signed_at', 'landlord_signed_at', 'pdf_path'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }
    if (updates.length === 0) return NextResponse.json({ updated: 0 });
    updates.push('updated_at = ?'); values.push(now); values.push(id);

    const result = db.prepare(`UPDATE inspections SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
