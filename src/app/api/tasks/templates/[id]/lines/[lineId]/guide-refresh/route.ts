import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { refreshTodayGuide, templateLineBelongsToTemplate } from '@/lib/odoo-tasks';
import { assertTemplateCompany } from '@/lib/tasks-scope';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Re-copy the library guide onto this task's line on TODAY's list.
 *
 * A daily task carries a FROZEN copy of the guide taken at spawn, so a guide
 * published (or edited) later never reaches a list that already exists. This is
 * the manager's opt-in way to bring today's copy up to date. Today only —
 * a past day is the record of what staff were actually shown.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // BOTH halves of the tenant boundary. assertTemplateCompany validates the
    // template in the URL, but the Odoo call takes only lineId and resolves the
    // department from line.template_id — so without the pairing check the
    // authorised record and the written record would be different objects, and
    // an in-company manager could rewrite a guide on another restaurant's live
    // list. (This is the exact hole the review caught on the today/ route.)
    await assertTemplateCompany(user, templateId);
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      // 404, not 403 — don't confirm the line exists.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...(await refreshTodayGuide(lineId)) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to refresh the guide';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
