export const dynamic = 'force-dynamic';
/**
 * GET  /api/closing-report/report?department_id=&date=   — the report (or the
 *      questions to fill in) for one department and night.
 * POST /api/closing-report/report                        — submit tonight's report.
 *
 * One report per department per night — the UNIQUE constraint resolves races;
 * a loser gets 409 and reloads into the read view.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP } from '@/lib/closing-report/access';
import {
  authorize, initClosingTables, jsonError, requestedDepartment, requestedNight, resolveCompany,
} from '@/lib/closing-report/route-helpers';
import {
  ReportExistsError, collectReportPhotos, createReport, getReport, listQuestions,
} from '@/lib/closing-report/db';
import { closingOperationalDate, reportEditable } from '@/lib/closing-report/night';
import { normalizeAnswers } from '@/lib/closing-report/validate';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const departmentId = requestedDepartment(request);
  if (!departmentId) return jsonError(400, 'Which department?');

  const date = requestedNight(request);
  const report = getReport(companyId, departmentId, date);
  const editable = !!report && reportEditable(report.report_date);
  return NextResponse.json({
    date,
    department_id: departmentId,
    report,
    editable,
    can_edit: editable && report?.submitted_by_user_id === authz.actor.userId,
    questions: report ? undefined : listQuestions(companyId, departmentId),
  });
}

interface AnswerPayload { question_id: number; value?: unknown; note?: unknown; photos?: unknown }

export async function POST(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.submit, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  let body: { department_id?: unknown; answers?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const departmentId = typeof body.department_id === 'number' ? body.department_id : 0;
  if (!departmentId || departmentId < 1) return jsonError(400, 'Which department?');
  const answersIn: AnswerPayload[] = Array.isArray(body.answers) ? body.answers : [];

  // A report is always about the CURRENT night — no backfilling old nights.
  const date = closingOperationalDate();
  const questions = listQuestions(companyId, departmentId);
  if (questions.length === 0) {
    return jsonError(400, 'No questions are set up for this department yet — ask a manager.');
  }

  const validated = normalizeAnswers(questions, answersIn);
  if (!validated.ok) {
    return NextResponse.json({ error: 'Please check the highlighted questions.', errors: validated.errors }, { status: 422 });
  }

  const photosByQuestionId = collectReportPhotos(
    answersIn.filter((a) => typeof a?.question_id === 'number'),
  );

  try {
    const reportId = createReport(
      {
        company_id: companyId,
        department_id: departmentId,
        report_date: date,
        submitted_by_user_id: authz.actor.userId,
        submitted_by_name: authz.actor.name,
      },
      validated.rows,
      photosByQuestionId,
    );
    return NextResponse.json({ ok: true, report_id: reportId, date });
  } catch (e) {
    if (e instanceof ReportExistsError) {
      return jsonError(409, 'Someone already submitted tonight’s report for this department.');
    }
    console.error('[closing-report] submit failed:', e);
    return jsonError(500, 'Could not save the report. Please try again.');
  }
}
