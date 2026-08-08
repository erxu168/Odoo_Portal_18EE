export const dynamic = 'force-dynamic';
/**
 * POST /api/closing-report/create-task  { answer_id, name? }
 *
 * One tap on a flagged answer → an ad-hoc task on that department's Task
 * Manager list for TODAY (the manager reviews last night in the morning).
 *
 * Exactly-once across SQLite and Odoo (which share no transaction):
 *  1. a deterministic marker (closing-report#<report>/a<answer>) goes into the
 *     task note, and the target list is SEARCHED for it first — a retry after a
 *     lost response adopts the existing task instead of duplicating it;
 *  2. the answer is claimed atomically (negative epoch token) before the Odoo
 *     write; a failed write releases the claim, an abandoned claim (crash) can
 *     be taken over after it goes stale.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { berlinToday } from '@/lib/berlin-date';
import { addAdHocLine, ensureListForDeptDate } from '@/lib/odoo-tasks';
import { getOdoo } from '@/lib/odoo';
import { fetchDepartments } from '@/lib/shifts-odoo';
import { CAP, canAccessCompany } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError } from '@/lib/closing-report/route-helpers';
import {
  claimAgeSeconds, claimAnswerForTask, claimToken, getAnswerWithReport,
  releaseClaim, setAnswerTaskLine, takeOverClaim,
} from '@/lib/closing-report/db';

const STALE_CLAIM_SECONDS = 120;

export async function POST(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.review, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();

  let body: { answer_id?: unknown; name?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  const answerId = typeof body.answer_id === 'number' ? body.answer_id : 0;
  if (!answerId || answerId < 1) return jsonError(400, 'Which answer?');

  const found = getAnswerWithReport(answerId);
  if (!found || !canAccessCompany(authz.user, found.report.company_id)) {
    return jsonError(404, 'Answer not found.');
  }
  const { answer, report } = found;
  if (!answer.is_problem) return jsonError(400, 'Only a flagged problem can become a task.');
  if (answer.task_line_id && answer.task_line_id > 0) {
    return NextResponse.json({ ok: true, task_line_id: answer.task_line_id, already: true });
  }

  // Stable across pre-lock corrections (which delete + recreate answer rows):
  // the question id survives a correction, the answer row id does not.
  const marker = answer.question_id != null
    ? `closing-report#${report.id}/q${answer.question_id}`
    : `closing-report#${report.id}/a${answer.id}`;
  let listId: number;
  try {
    // Tenant guard: the report's department must really belong to its company
    // before we touch that department's task list.
    const depts = await fetchDepartments(report.company_id);
    if (!depts.some((d) => d.id === report.department_id)) {
      return jsonError(400, 'This department does not belong to the selected restaurant.');
    }
    listId = await ensureListForDeptDate(report.department_id, berlinToday());

    // Adopt a task an earlier attempt already created (lost response, crash).
    const existing: { id: number }[] = await getOdoo().searchRead(
      'krawings.task.list.line',
      [['list_id', '=', listId], ['manager_note', 'ilike', marker]],
      ['id'],
      { limit: 1 },
    );
    if (existing.length > 0) {
      setAnswerTaskLine(answer.id, existing[0].id);
      return NextResponse.json({ ok: true, task_line_id: existing[0].id, already: true });
    }
  } catch (e) {
    console.error('[closing-report] create-task preflight failed:', e);
    return jsonError(502, 'Could not reach Task Manager. Please try again.');
  }

  // Claim the answer so a double-tap or two managers racing create one task.
  const token = claimToken();
  if (answer.task_line_id != null && answer.task_line_id < 0) {
    // Someone claimed earlier but no task exists (checked above). Fresh claim →
    // they are mid-create; stale → they crashed, take it over.
    if (claimAgeSeconds(answer.task_line_id) < STALE_CLAIM_SECONDS) {
      return jsonError(409, 'A task for this answer is already being created — give it a moment.');
    }
    if (!takeOverClaim(answer.id, answer.task_line_id, token)) {
      return jsonError(409, 'A task for this answer is already being created — give it a moment.');
    }
  } else if (!claimAnswerForTask(answer.id, token)) {
    return jsonError(409, 'A task for this answer is already being created — give it a moment.');
  }

  const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, 200)
    || `Follow up: ${answer.question_text}`.slice(0, 200);

  try {
    const noteParts = [
      `From the closing report, night of ${report.report_date}.`,
      `${answer.question_text} — ${answer.value}${answer.note ? `: “${answer.note}”` : ''}`,
      `Reported by ${report.submitted_by_name || 'staff'} · ${marker}`,
    ];
    const lineId = await addAdHocLine(listId, {
      name,
      day_part: 'opening',
      manager_note: noteParts.join('\n'),
      module_link_type: 'none',
    });
    setAnswerTaskLine(answer.id, lineId);
    return NextResponse.json({ ok: true, task_line_id: lineId });
  } catch (e) {
    releaseClaim(answer.id, token); // so a retry can succeed (the marker search covers a phantom create)
    console.error('[closing-report] create-task failed:', e);
    return jsonError(502, 'Could not create the task in Task Manager. Please try again.');
  }
}
