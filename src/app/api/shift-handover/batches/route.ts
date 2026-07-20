export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getCurrentProduction } from '@/lib/shift-handover/queries';
import { recordBatch } from '@/lib/shift-handover/commands';

// GET — today's production (batches + containers). ?date=YYYY-MM-DD overrides.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  return NextResponse.json({ batches: getCurrentProduction(companyId, operationalDate(request)), operational_date: operationalDate(request) });
}

// POST — record a new production batch with one or more containers.
export async function POST(request: Request) {
  const authz = authorize(CAP.record, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const productId = parseInt(String(body?.product_id), 10);
  if (!productId) return jsonError(400, 'Choose a product.');
  const result = recordBatch(companyId, authz.actor, {
    operational_date: body.operational_date || operationalDate(request),
    product_id: productId,
    shift_label: body.shift_label ?? null,
    note: body.note ?? null,
    containers: Array.isArray(body.containers) ? body.containers : [],
  });
  if (!result.ok) return NextResponse.json({ error: result.error, validation: result.validation }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
