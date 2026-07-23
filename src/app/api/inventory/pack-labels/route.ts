export const dynamic = 'force-dynamic';
/**
 * /api/inventory/pack-labels — the editable "Count by" unit vocabulary
 * (piece/bunch/crate…). GLOBAL (product_flags.pack_label is one value per shared
 * product) — a change here affects EVERY restaurant, so writes are ADMIN-only.
 * Any authenticated user may read it. Deleting a unit still in use by a product
 * is refused; renaming CASCADES to the products counted in it.
 *
 * GET    — list units (seeds the defaults on first use)
 * POST   — add a unit         body: { label }         (admin)
 * PATCH  — rename a unit       body: { id, label }     (admin)
 * DELETE — remove a unit      ?id=                     (admin)
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { initInventoryTables, listPackLabels, addPackLabel, deletePackLabel, renamePackLabel } from '@/lib/inventory-db';

// GLOBAL list (all restaurants share it) → an admin must make the change.
const ADMIN_ONLY = 'Only an admin can change count-by units — they are shared across all restaurants';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();
  return NextResponse.json({ labels: listPackLabels() });
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });
  initInventoryTables();

  const body = await request.json();
  const label = typeof body.label === 'string' ? body.label : '';
  const row = addPackLabel(label, user.id);
  if (!row) return NextResponse.json({ error: 'That unit already exists or is invalid' }, { status: 400 });
  return NextResponse.json({ label: row }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });
  initInventoryTables();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const id = Number((body as { id?: unknown }).id);
  const raw = typeof (body as { label?: unknown }).label === 'string' ? (body as { label: string }).label : '';
  const label = raw.trim().replace(/\s+/g, ' ');
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid unit id is required' }, { status: 400 });
  if (!label) return NextResponse.json({ error: 'A name is required' }, { status: 400 });
  if (label.length > 24) return NextResponse.json({ error: 'Keep the unit under 24 characters' }, { status: 400 });
  const res = renamePackLabel(id, label);
  if (!res.ok && res.dupe) return NextResponse.json({ error: 'That unit already exists' }, { status: 409 });
  if (!res.ok) return NextResponse.json({ error: 'Unit not found or invalid name' }, { status: 404 });
  return NextResponse.json({ message: 'Unit renamed' });
}

export async function DELETE(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: ADMIN_ONLY }, { status: 403 });
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
