// src/app/api/rentals/rooms/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Room, Tenancy, Tenant, Payment, TenancyRentStep } from '@/types/rentals';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as Room | undefined;
    if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const tenancy = db.prepare(`
      SELECT * FROM tenancies WHERE room_id = ? AND status IN ('active','ending') LIMIT 1
    `).get(id) as Tenancy | undefined;

    let tenant: Tenant | undefined;
    let nextStep: TenancyRentStep | undefined;
    let payments: Payment[] = [];

    if (tenancy) {
      tenant = db.prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenancy.tenant_id) as Tenant;
      nextStep = db.prepare(`
        SELECT * FROM tenancy_rent_steps
        WHERE tenancy_id = ? AND applied = 0
        ORDER BY effective_date ASC LIMIT 1
      `).get(tenancy.id) as TenancyRentStep | undefined;
      payments = db.prepare(`
        SELECT * FROM payments WHERE tenancy_id = ?
        ORDER BY expected_date DESC LIMIT 12
      `).all(tenancy.id) as Payment[];
    }

    return NextResponse.json({ room, tenancy, tenant, nextStep, payments });
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

    const fields = ['room_code', 'room_name', 'size_sqm', 'base_kaltmiete', 'utility_share', 'status', 'notes'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }
    if (updates.length === 0) return NextResponse.json({ updated: 0 });

    updates.push(`updated_at = ?`);
    values.push(now);
    values.push(id);

    const result = db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values);
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
    const result = db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
