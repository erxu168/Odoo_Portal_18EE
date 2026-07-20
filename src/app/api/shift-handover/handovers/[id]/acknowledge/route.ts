export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { acknowledgeHandover } from '@/lib/shift-handover/commands';
import { DISCREPANCY_TYPES } from '@/lib/shift-handover/states';

// POST — the incoming shift leader acknowledges (optionally with discrepancies).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.acknowledge, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json().catch(() => ({}));
  const discrepancies = (Array.isArray(body?.discrepancies) ? body.discrepancies : [])
    .filter((d: { discrepancy_type?: string }) => d?.discrepancy_type && (DISCREPANCY_TYPES as readonly string[]).includes(d.discrepancy_type));
  const result = acknowledgeHandover(companyId, authz.actor, parseInt(params.id, 10), {
    outcome: body?.outcome ?? null, note: body?.note ?? null, discrepancies,
  }, body?.idempotency_key ?? null);
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result);
}
