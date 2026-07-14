/**
 * /api/issues/equipment
 *
 * GET  — list equipment (manager/admin only)
 * POST — create equipment (manager/admin only)
 *
 * POST also fires a fire-and-forget Odoo sync so the equipment appears
 * in Odoo's maintenance.equipment table. Sync failures are logged but
 * do NOT fail the portal request.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initIssuesTables, listEquipment, createEquipment, getEquipment } from '@/lib/issues-db';
import { syncEquipmentToOdoo } from '@/lib/issues-odoo-sync';
import { logAudit } from '@/lib/db';

initIssuesTables();

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location') || undefined;
  const search = searchParams.get('search') || undefined;

  const equipment = listEquipment({ location, search });

  const grouped: Record<string, typeof equipment> = {};
  for (const eq of equipment) {
    const loc = eq.location || 'Unknown';
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(eq);
  }

  return NextResponse.json({ equipment, grouped });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { name, brand, model, serial_number, location, location_detail, purchase_date, purchase_cost, warranty_expires, vendor_name, vendor_contact } = body;

  if (!name || !location) {
    return NextResponse.json({ error: 'name and location required' }, { status: 400 });
  }

  const id = createEquipment({
    name, brand, model, serial_number, location, location_detail,
    purchase_date, purchase_cost, warranty_expires, vendor_name, vendor_contact,
  });

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'create_equipment',
    module: 'issues',
    target_type: 'equipment',
    detail: `Created equipment: ${name} at ${location}`,
  });

  // Fire-and-forget Odoo sync. Never await — the portal stays snappy even
  // if Odoo is slow/down. syncEquipmentToOdoo catches its own errors.
  const created = getEquipment(id);
  if (created) {
    syncEquipmentToOdoo(created).catch((err) => {
      console.warn(`[equipment POST] Odoo sync failed for ${id}:`, err);
    });
  }

  return NextResponse.json({ id, message: 'Equipment created' }, { status: 201 });
}
