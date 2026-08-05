import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { todayLineStatus, addTemplateLineToToday, templateLineBelongsToTemplate } from '@/lib/odoo-tasks';
import { assertTemplateCompany } from '@/lib/tasks-scope';

/**
 * "Add this task to today's list too."
 *
 * A day's list is a SNAPSHOT taken once at spawn, so a task added to the
 * template afterwards only appears tomorrow. This is the manager's opt-in way
 * to top up the list that is already running.
 *
 *   GET  → { can_add, reason, date, department_name }   (read-only, drives the prompt)
 *   POST → { ok, added, reason }                        (idempotent; re-checks everything)
 */
function ids(params: { id: string; lineId: string }) {
  return { templateId: parseInt(params.id, 10), lineId: parseInt(params.lineId, 10) };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const { templateId, lineId } = ids(params);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // Tenant boundary, in TWO parts — the company check alone is not enough here.
    // assertTemplateCompany validates the template in the URL, but the Odoo call
    // takes only lineId and resolves the department from line.template_id. Without
    // the pairing check the authorised record and the written record are different
    // objects, so an in-company manager could name their own template and another
    // company's line and write onto that restaurant's live list. Every sibling
    // route under [lineId]/ pairs these two; this one must as well.
    await assertTemplateCompany(user, templateId);
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      // 404, not 403 — don't confirm the line exists.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...(await todayLineStatus(lineId)) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to check today’s list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const { templateId, lineId } = ids(params);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // Tenant boundary, in TWO parts — the company check alone is not enough here.
    // assertTemplateCompany validates the template in the URL, but the Odoo call
    // takes only lineId and resolves the department from line.template_id. Without
    // the pairing check the authorised record and the written record are different
    // objects, so an in-company manager could name their own template and another
    // company's line and write onto that restaurant's live list. Every sibling
    // route under [lineId]/ pairs these two; this one must as well.
    await assertTemplateCompany(user, templateId);
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      // 404, not 403 — don't confirm the line exists.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Odoo additionally re-checks that the line is due today and not already on
    // the list, so a stale prompt or a double tap cannot duplicate a task.
    const result = await addTemplateLineToToday(lineId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to add the task to today’s list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
