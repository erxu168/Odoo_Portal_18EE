export const dynamic = 'force-dynamic';
/**
 * PATCH/DELETE /api/closing-report/manage/questions/[id]
 * Edits shape future reports only; deletes are safe because submitted reports
 * carry their own question snapshots.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP, canAccessCompany } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError } from '@/lib/closing-report/route-helpers';
import { validateQuestionInput } from '@/lib/closing-report/validate';
import { deleteQuestion, getQuestion, updateQuestion } from '@/lib/closing-report/db';
import type { PortalUser } from '@/lib/db';

function loadScoped(idRaw: string, user: PortalUser) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id < 1) return null;
  const q = getQuestion(id);
  if (!q || !canAccessCompany(user, q.company_id)) return null;
  return q;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const q = loadScoped(params.id, authz.user);
  if (!q) return jsonError(404, 'Question not found.');
  let body: { text?: unknown; qtype?: unknown; options?: unknown; problem_values?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const v = validateQuestionInput(body);
  if (!v.ok) return jsonError(400, v.error);
  updateQuestion(q.id, v);
  return NextResponse.json({ ok: true, question: getQuestion(q.id) });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const q = loadScoped(params.id, authz.user);
  if (!q) return jsonError(404, 'Question not found.');
  deleteQuestion(q.id);
  return NextResponse.json({ ok: true });
}
