export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getStorageItem, markStorageUsed } from '@/lib/shift-handover/db';

// POST — mark an "In storage now" item as used up, so it leaves the tray.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const item = getStorageItem(parseInt(params.id, 10));
  if (!item || item.company_id !== companyId) return jsonError(404, 'Item not found.');

  markStorageUsed(item.id, companyId, authz.actor);
  return NextResponse.json({ ok: true });
}
