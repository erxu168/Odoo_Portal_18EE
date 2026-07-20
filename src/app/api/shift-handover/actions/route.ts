export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, operationalDate, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP, authorize as authz2 } from '@/lib/shift-handover/access';
import { listActions } from '@/lib/shift-handover/db';
import { createActionCmd } from '@/lib/shift-handover/commands';
import { ACTION_PRIORITIES } from '@/lib/shift-handover/states';

export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const p = new URL(request.url).searchParams;
  const status = p.get('status') || undefined;
  const openOnly = p.get('open') === '1';
  const actions = openOnly
    ? listActions([companyId], { statuses: ['open', 'in_progress'] })
    : listActions([companyId], { status, operational_date: p.get('date') || undefined });
  return NextResponse.json({ actions });
}

// POST — create a task/next-action.
export async function POST(request: Request) {
  const authz = authorize(CAP.actionCreate, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const body = await request.json();
  const priority = ACTION_PRIORITIES.includes(body?.priority) ? body.priority : 'normal';
  // Only managers may create a food-safety-critical task.
  if (priority === 'food_safety_critical') {
    const crit = authz2(CAP.actionManageCritical);
    if (!crit.ok) return jsonError(crit.status, 'Only a manager can flag a task food-safety critical.');
  }
  const result = createActionCmd(companyId, authz.actor, {
    operational_date: body.operational_date || operationalDate(request),
    instruction: body.instruction, priority, assigned_role: body.assigned_role ?? null, due_at: body.due_at ?? null,
    batch_id: body.batch_id ?? null, container_id: body.container_id ?? null, handover_id: body.handover_id ?? null,
  });
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result, { status: 201 });
}
