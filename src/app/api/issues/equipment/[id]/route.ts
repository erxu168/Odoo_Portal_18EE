/**
 * /api/issues/equipment/[id]
 *
 * GET — equipment detail (with docs, photos, repair history)
 * PUT — update equipment (manager/admin only). Also fires fire-and-forget
 *        Odoo sync to mirror the update into maintenance.equipment.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import {
  initIssuesTables, getEquipment, updateEquipment,
  getEquipmentDocs, getEquipmentPhotos, getEquipmentRepairHistory,
} from '@/lib/issues-db';
import { syncEquipmentToOdoo } from '@/lib/issues-odoo-sync';
import { logAudit } from '@/lib/db';

initIssuesTables();

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const equipment = getEquipment(params.id);
  if (!equipment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const docs = getEquipmentDocs(params.id);
  const photos = getEquipmentPhotos(params.id);
  const repair_history = getEquipmentRepairHistory(params.id);

  const cost_percentage = equipment.purchase_cost && equipment.purchase_cost > 0
    ? Math.round((equipment.total_repair_cost / equipment.purchase_cost) * 100)
    : null;

  return NextResponse.json({ equipment, docs, photos, repair_history, cost_percentage });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const equipment = getEquipment(params.id);
  if (!equipment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  updateEquipment(params.id, body);

  logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'update_equipment',
    module: 'issues',
    target_type: 'equipment',
    detail: `Updated equipment ${equipment.name}: ${Object.keys(body).join(', ')}`,
  });

  // Fire-and-forget Odoo sync with the post-update state
  const updated = getEquipment(params.id);
  if (updated) {
    syncEquipmentToOdoo(updated).catch((err) => {
      console.warn(`[equipment PUT] Odoo sync failed for ${params.id}:`, err);
    });
  }

  return NextResponse.json({ message: 'Equipment updated' });
}
