export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP, authorize as authz2 } from '@/lib/shift-handover/access';
import { getAction } from '@/lib/shift-handover/db';
import { updateActionCmd } from '@/lib/shift-handover/commands';

// PATCH — edit priority / status / due / assignment. Critical tasks are manager-gated.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.actionCreate, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const action = getAction(parseInt(params.id, 10));
  if (!action || action.company_id !== companyId) return jsonError(404, 'Task not found.');
  const body = await request.json();
  // Touching a critical task (or making one) requires manager authority.
  const touchesCritical = action.priority === 'food_safety_critical' || body?.priority === 'food_safety_critical';
  if (touchesCritical) {
    const crit = authz2(CAP.actionManageCritical);
    if (!crit.ok) return jsonError(crit.status, 'Only a manager can change a food-safety-critical task.');
  }
  const result = updateActionCmd(companyId, authz.actor, action.id, {
    instruction: body.instruction, priority: body.priority, assigned_role: body.assigned_role, due_at: body.due_at, status: body.status,
  });
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result);
}
