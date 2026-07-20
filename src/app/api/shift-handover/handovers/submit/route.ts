export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { submitHandover } from '@/lib/shift-handover/commands';

// POST — freeze and submit the outgoing shift's handover (immutable snapshot).
export async function POST(request: Request) {
  const authz = authorize(CAP.submit, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json().catch(() => ({}));
  const result = submitHandover(companyId, authz.actor, {
    operational_date: body?.operational_date || operationalDate(request),
    outgoing_shift_label: body?.outgoing_shift_label ?? null,
    incoming_shift_label: body?.incoming_shift_label ?? null,
    summary_note: body?.summary_note ?? null,
  }, body?.idempotency_key ?? null);
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result, { status: 201 });
}
