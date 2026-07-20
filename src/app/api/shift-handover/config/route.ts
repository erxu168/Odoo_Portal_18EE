export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getConfig } from '@/lib/shift-handover/queries';
import { DEFAULT_SHIFT_LABELS } from '@/lib/shift-handover/seed';

export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  return NextResponse.json({ ...getConfig(companyId), shift_labels: DEFAULT_SHIFT_LABELS, company_id: companyId });
}
