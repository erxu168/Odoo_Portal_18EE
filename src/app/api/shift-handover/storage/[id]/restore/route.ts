export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getStorageItem, restoreStorageItem } from '@/lib/shift-handover/db';
import { moduleForbidden } from '@/lib/module-access';

// POST — undo a just-cleared item: put it back in "In storage now".
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('shift-handover');
  if (denied) return denied;

  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const item = getStorageItem(parseInt(params.id, 10));
  if (!item || item.company_id !== companyId) return jsonError(404, 'Item not found.');

  const restored = restoreStorageItem(item.id, companyId);
  if (!restored) return jsonError(409, 'Too late to undo — it is no longer just cleared.');
  return NextResponse.json({ ok: true });
}
