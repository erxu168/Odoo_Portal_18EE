export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { resolveDiscrepancyCmd } from '@/lib/shift-handover/commands';

// POST — a manager resolves a reported discrepancy.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.discrepancyResolve, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json().catch(() => ({}));
  const result = resolveDiscrepancyCmd(companyId, authz.actor, parseInt(params.id, 10), body?.resolution_note ?? null);
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result);
}
