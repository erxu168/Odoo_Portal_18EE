/**
 * /api/issues/equipment
 *
 * GET  — list equipment (manager/admin only)
 * POST — create equipment (manager/admin only)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initIssuesTables, listEquipment, createEquipment } from '@/lib/issues-db';
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

  return NextResponse.json({ id, message: 'Equipment created' }, { status: 201 });
}
