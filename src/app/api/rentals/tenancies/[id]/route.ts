// src/app/api/rentals/tenancies/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Tenancy, Tenant, Room, Property } from '@/types/rentals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);

    const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(id) as Tenancy | undefined;
    if (!tenancy) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenancy.tenant_id) as Tenant;
    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(tenancy.room_id) as Room;
    const property = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(room.property_id) as Property;
    const rentSteps = db.prepare(`
      SELECT * FROM tenancy_rent_steps WHERE tenancy_id = ? ORDER BY effective_date
    `).all(id);
    const payments = db.prepare(`
      SELECT * FROM payments WHERE tenancy_id = ? ORDER BY expected_date DESC LIMIT 24
    `).all(id);
    const inspections = db.prepare(`
      SELECT id, type, inspection_date, status, pdf_path FROM inspections WHERE tenancy_id = ?
      ORDER BY inspection_date DESC
    `).all(id);

    return NextResponse.json({ tenancy, tenant, room, property, rentSteps, payments, inspections });
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

    const fields = ['start_date', 'end_date', 'contract_type', 'kaltmiete', 'nebenkosten', 'kaution', 'kaution_received',
                    'status', 'contract_pdf_path', 'signed_at', 'notes'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }

    // Recompute warmmiete if rent components changed
    if (body.kaltmiete !== undefined || body.nebenkosten !== undefined) {
      const current = db.prepare(`SELECT kaltmiete, nebenkosten FROM tenancies WHERE id = ?`).get(id) as { kaltmiete: number; nebenkosten: number };
      const newKalt = body.kaltmiete ?? current.kaltmiete;
      const newNeben = body.nebenkosten ?? current.nebenkosten;
      updates.push('warmmiete = ?');
      values.push(newKalt + newNeben);
    }

    if (updates.length === 0) return NextResponse.json({ updated: 0 });

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const result = db.prepare(`UPDATE tenancies SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // If status switches to ended, release the room
    if (body.status === 'ended' || body.status === 'cancelled') {
      const t = db.prepare(`SELECT room_id FROM tenancies WHERE id = ?`).get(id) as { room_id: number };
      db.prepare(`UPDATE rooms SET status = 'vacant', updated_at = ? WHERE id = ?`).run(now, t.room_id);
    }

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
    const now = berlinNow();

    // Release the room before deleting
    const tenancy = db.prepare(`SELECT room_id, status FROM tenancies WHERE id = ?`).get(id) as { room_id: number; status: string } | undefined;
    if (tenancy && (tenancy.status === 'active' || tenancy.status === 'ending')) {
      db.prepare(`UPDATE rooms SET status = 'vacant', updated_at = ? WHERE id = ?`).run(now, tenancy.room_id);
    }

    // Delete related records
    db.prepare(`DELETE FROM payments WHERE tenancy_id = ?`).run(id);
    db.prepare(`DELETE FROM tenancy_rent_steps WHERE tenancy_id = ?`).run(id);
    db.prepare(`DELETE FROM inspections WHERE tenancy_id = ?`).run(id);
    const result = db.prepare(`DELETE FROM tenancies WHERE id = ?`).run(id);

    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
