export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getContainerDetail } from '@/lib/shift-handover/queries';
import { updateContainerCmd } from '@/lib/shift-handover/commands';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const detail = getContainerDetail(companyId, parseInt(params.id, 10));
  if (!detail) return jsonError(404, 'Container not found.');
  return NextResponse.json(detail);
}

// PATCH — move / re-state / mark depleted etc. Validated in the command layer.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.record, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const result = updateContainerCmd(companyId, authz.actor, parseInt(params.id, 10), body ?? {});
  if (!result.ok) return NextResponse.json({ error: result.error, validation: result.validation }, { status: result.status });
  return NextResponse.json(result);
}
