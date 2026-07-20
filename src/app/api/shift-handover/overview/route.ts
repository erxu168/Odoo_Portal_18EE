export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { seedHandoverDefaults } from '@/lib/shift-handover/seed';
import { getOverview } from '@/lib/shift-handover/queries';

export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  // First visit for a company provisions the default products / container types /
  // storage locations so the module is usable immediately.
  seedHandoverDefaults(companyId, authz.actor.userId);
  return NextResponse.json({ overview: getOverview(companyId, operationalDate(request)), company_id: companyId, operational_date: operationalDate(request) });
}
