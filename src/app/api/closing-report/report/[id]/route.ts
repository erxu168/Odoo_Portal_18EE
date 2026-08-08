export const dynamic = 'force-dynamic';
/**
 * GET    /api/closing-report/report/[id]  — one report (canonical record read).
 * PUT    /api/closing-report/report/[id]  — the submitter corrects it before the
 *        05:00 lock. Validates against the report's own frozen snapshot, never
 *        the live template — a template edit overnight cannot change tonight's rules.
 * DELETE /api/closing-report/report/[id]  — manager removes a bogus report
 *        (frees the night for a resubmit).
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP, canAccessCompany } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError } from '@/lib/closing-report/route-helpers';
import {
  collectReportPhotos, deleteReport, getReportById, questionsFromSnapshot, updateReportAnswers,
} from '@/lib/closing-report/db';
import { reportEditable } from '@/lib/closing-report/night';
import { normalizeAnswers } from '@/lib/closing-report/validate';

function loadScoped(idRaw: string, authzUser: Parameters<typeof canAccessCompany>[0]) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id < 1) return null;
  const report = getReportById(id);
  if (!report || !canAccessCompany(authzUser, report.company_id)) return null; // out of scope reads as absent
  return report;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const report = loadScoped(params.id, authz.user);
  if (!report) return jsonError(404, 'Report not found.');
  const editable = reportEditable(report.report_date);
  return NextResponse.json({
    report,
    editable,
    can_edit: editable && report.submitted_by_user_id === authz.actor.userId,
  });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.submit, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const report = loadScoped(params.id, authz.user);
  if (!report) return jsonError(404, 'Report not found.');
  if (report.submitted_by_user_id !== authz.actor.userId) {
    return jsonError(403, `Only ${report.submitted_by_name || 'the person who submitted it'} can correct this report.`);
  }
  if (!reportEditable(report.report_date)) {
    return jsonError(409, 'This report is locked — corrections close at 05:00 the next morning.');
  }

  let body: { answers?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const answersIn = Array.isArray(body.answers) ? body.answers : [];

  const questions = questionsFromSnapshot(report);
  const validated = normalizeAnswers(questions, answersIn);
  if (!validated.ok) {
    return NextResponse.json({ error: 'Please check the highlighted questions.', errors: validated.errors }, { status: 422 });
  }

  const photosByQuestionId = collectReportPhotos(
    answersIn.filter((a: { question_id?: unknown }) => a && typeof a.question_id === 'number'),
  );

  updateReportAnswers(report, validated.rows, photosByQuestionId,
    { userId: authz.actor.userId, name: authz.actor.name });
  return NextResponse.json({ ok: true, report: getReportById(report.id) });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const report = loadScoped(params.id, authz.user);
  if (!report) return jsonError(404, 'Report not found.');
  deleteReport(report.id);
  return NextResponse.json({ ok: true });
}
