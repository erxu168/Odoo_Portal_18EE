export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getBatch, listContainersByBatch } from '@/lib/shift-handover/db';
import { addContainersToBatch } from '@/lib/shift-handover/commands';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const batch = getBatch(parseInt(params.id, 10));
  if (!batch || batch.company_id !== companyId) return jsonError(404, 'Batch not found.');
  return NextResponse.json({ batch, containers: listContainersByBatch(batch.id) });
}

// POST — add more containers to this batch (fast-entry supported via container.count).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.record, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const result = addContainersToBatch(companyId, authz.actor, parseInt(params.id, 10), Array.isArray(body?.containers) ? body.containers : []);
  if (!result.ok) return NextResponse.json({ error: result.error, validation: result.validation }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
