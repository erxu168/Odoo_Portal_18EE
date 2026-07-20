export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP, authorize as authz2 } from '@/lib/shift-handover/access';
import { getAction } from '@/lib/shift-handover/db';
import { completeActionCmd } from '@/lib/shift-handover/commands';

// POST — mark a task done (optional completion note + photo).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.actionCreate, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const action = getAction(parseInt(params.id, 10));
  if (!action || action.company_id !== companyId) return jsonError(404, 'Task not found.');
  // Completing a food-safety-critical task is a manager responsibility.
  if (action.priority === 'food_safety_critical') {
    const crit = authz2(CAP.actionManageCritical);
    if (!crit.ok) return jsonError(crit.status, 'Only a manager can complete a food-safety-critical task.');
  }
  const body = await request.json().catch(() => ({}));
  const result = completeActionCmd(companyId, authz.actor, action.id, body?.note ?? null, body?.photo ?? null);
  if (!result.ok) return jsonError(result.status, result.error);
  return NextResponse.json(result);
}
