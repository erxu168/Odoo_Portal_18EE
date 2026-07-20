export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listDiscrepancies, getHandover } from '@/lib/shift-handover/db';
import { reportDiscrepancyCmd } from '@/lib/shift-handover/commands';
import { DISCREPANCY_TYPES } from '@/lib/shift-handover/states';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const h = getHandover(parseInt(params.id, 10));
  if (!h || h.company_id !== companyId) return jsonError(404, 'Handover not found.');
  return NextResponse.json({ discrepancies: listDiscrepancies(h.id) });
}

// POST — report a discrepancy against a submitted handover (does not alter the snapshot).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.acknowledge, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  if (!(DISCREPANCY_TYPES as readonly string[]).includes(body?.discrepancy_type)) return jsonError(400, 'Choose a discrepancy type.');
  const result = reportDiscrepancyCmd(companyId, authz.actor, parseInt(params.id, 10), {
    discrepancy_type: body.discrepancy_type, snapshot_container_id: body.snapshot_container_id ?? null,
    expected_value: body.expected_value ?? null, reported_value: body.reported_value ?? null,
    note: body.note ?? null, photo: body.photo ?? null,
  });
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result, { status: 201 });
}
