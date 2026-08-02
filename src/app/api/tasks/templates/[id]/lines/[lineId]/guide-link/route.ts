import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { templateLineBelongsToTemplate, getTemplateCompany, getGuideScope } from '@/lib/odoo-tasks';
import { getTemplateLineGuideLink, attachGuideToTemplateLine } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

function ids(params: { id: string; lineId: string }): { templateId: number; lineId: number } | null {
  const templateId = parseInt(params.id, 10);
  const lineId = parseInt(params.lineId, 10);
  if (Number.isNaN(templateId) || Number.isNaN(lineId)) return null;
  return { templateId, lineId };
}

/** Line must belong to the template AND the template's company must be allowed. */
async function assertScope(user: PortalUser, templateId: number, lineId: number): Promise<number | null> {
  if (!(await templateLineBelongsToTemplate(templateId, lineId))) throw new AuthError('Not found', 404);
  const company = await getTemplateCompany(templateId);
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length && company !== null && !allowed.includes(company)) throw new AuthError('Forbidden', 403);
  return company;
}

// GET — which library guide (if any) this task links, + its headline state.
export async function GET(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const link = await getTemplateLineGuideLink(p.lineId);
    const res = NextResponse.json(link || { template_line_id: p.lineId, guide_id: false, name: '', published: false, revision: 0, step_count: 0 });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guide-link error:', err);
    return NextResponse.json({ error: 'Failed to load guide link' }, { status: 500 });
  }
}

// PUT — attach ({ guide_id: <id> }) or detach ({ guide_id: null }) a library guide.
// Never edits guide content. The guide must be in the same company as the task.
export async function PUT(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const taskCompany = await assertScope(user, p.templateId, p.lineId);
    const body = await req.json();
    const raw = body?.guide_id;
    let guideId: number | null = null;
    if (raw !== null && raw !== undefined && raw !== false) {
      guideId = Number(raw);
      if (!Number.isInteger(guideId) || guideId <= 0) {
        return NextResponse.json({ error: 'Invalid guide id' }, { status: 400 });
      }
      // Verify the guide exists and is in the SAME company as the task (defence
      // in depth; the Odoo method + model constraint enforce this too).
      const scope = await getGuideScope(guideId);
      if (!scope) return NextResponse.json({ error: 'Guide not found' }, { status: 404 });
      if (taskCompany !== null && scope.companyId !== taskCompany) {
        return NextResponse.json({ error: 'That guide belongs to a different company.' }, { status: 400 });
      }
      const allowed = parseCompanyIds(user.allowed_company_ids);
      if (allowed.length && (scope.companyId === null || !allowed.includes(scope.companyId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    const link = await attachGuideToTemplateLine(p.lineId, guideId);
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide-link error:', err);
    const message = err instanceof Error ? err.message : 'Failed to update guide link';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
