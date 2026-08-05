import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { todayGuideStatus } from '@/lib/odoo-tasks';
import { assertTemplateCompany } from '@/lib/tasks-scope';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Which of this template's tasks have an out-of-date guide copy on TODAY's list.
 *
 * One call for the whole template so the editor can badge every row without a
 * request per task. Read-only.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    if (Number.isNaN(templateId)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }
    // Only the template id is used here and it IS the record we scope-check, so
    // the company assertion alone is sufficient — unlike the per-line routes,
    // where the authorised record and the written record differ.
    await assertTemplateCompany(user, templateId);
    return NextResponse.json({ ok: true, status: await todayGuideStatus(templateId) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to read today’s guide status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
