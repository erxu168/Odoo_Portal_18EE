export const dynamic = 'force-dynamic';
/**
 * /api/inventory/pack-labels — the editable "Count by" unit vocabulary
 * (piece/bunch/crate…). GLOBAL (product_flags.pack_label is one value per shared
 * product), so no company scope. Any authenticated user may read it; adding and
 * deleting need product-settings management. Deleting a unit still in use by a
 * product is refused (the response says how many use it).
 *
 * GET    — list units (seeds the defaults on first use)
 * POST   — add a unit         body: { label }
 * DELETE — remove a unit      ?id=
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { initInventoryTables, listPackLabels, addPackLabel, deletePackLabel } from '@/lib/inventory-db';

const KEY = 'inventory.productsettings.manage';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();
  return NextResponse.json({ labels: listPackLabels() });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const label = typeof body.label === 'string' ? body.label : '';
  const row = addPackLabel(label, user.id);
  if (!row) return NextResponse.json({ error: 'That unit already exists or is invalid' }, { status: 400 });
  return NextResponse.json({ label: row }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, KEY, getPermissionOverrides()))
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get('id');
  if (!idRaw || !/^\d+$/.test(idRaw)) return NextResponse.json({ error: 'A valid unit id is required' }, { status: 400 });

  const res = deletePackLabel(parseInt(idRaw, 10));
  if (!res.ok && res.in_use > 0) {
    return NextResponse.json({ error: `${res.in_use} product${res.in_use === 1 ? '' : 's'} still counted in this unit — change them first.` }, { status: 409 });
  }
  if (!res.ok) return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
  return NextResponse.json({ message: 'Unit removed' });
}
