export const dynamic = 'force-dynamic';
/** PUT /api/closing-report/manage/questions/reorder  { department_id, ordered_ids } */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, resolveCompany } from '@/lib/closing-report/route-helpers';
import { listQuestions, reorderQuestions } from '@/lib/closing-report/db';

export async function PUT(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  let body: { department_id?: unknown; ordered_ids?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const departmentId = typeof body.department_id === 'number' ? body.department_id : 0;
  if (!departmentId || departmentId < 1) return jsonError(400, 'Which department?');
  const ids = Array.isArray(body.ordered_ids) ? body.ordered_ids.filter((n): n is number => typeof n === 'number') : [];
  if (ids.length === 0) return jsonError(400, 'Bad request.');
  reorderQuestions(companyId, departmentId, ids);
  return NextResponse.json({ ok: true, questions: listQuestions(companyId, departmentId) });
}
