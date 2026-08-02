import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { templateLineBelongsToTemplate, getTemplateCompany } from '@/lib/odoo-tasks';
import { readTemplateGuide, saveTemplateGuide, deleteTemplateGuide } from '@/lib/task-guide';
import { sanitizeSteps } from '@/lib/task-guide-validate';

export const dynamic = 'force-dynamic';

function ids(params: { id: string; lineId: string }): { templateId: number; lineId: number } | null {
  const templateId = parseInt(params.id, 10);
  const lineId = parseInt(params.lineId, 10);
  if (Number.isNaN(templateId) || Number.isNaN(lineId)) return null;
  return { templateId, lineId };
}

/** Line must belong to the template AND the template's company must be allowed. */
async function assertScope(user: PortalUser, templateId: number, lineId: number): Promise<void> {
  if (!(await templateLineBelongsToTemplate(templateId, lineId))) throw new AuthError('Not found', 404);
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length) {
    const company = await getTemplateCompany(templateId);
    if (company !== null && !allowed.includes(company)) throw new AuthError('Forbidden', 403);
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const guide = await readTemplateGuide(p.lineId);
    const res = NextResponse.json(guide || { revision: 0, published: false, steps: [] });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guide error:', err);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const body = await req.json();
    const revision = Number(body?.revision);
    if (!Number.isInteger(revision)) return NextResponse.json({ error: 'Missing revision' }, { status: 400 });
    const published = !!body?.published;
    const steps = sanitizeSteps(body?.steps, published);
    const result = await saveTemplateGuide(p.lineId, revision, published, steps);
    if (result?.conflict) {
      return NextResponse.json(
        { error: 'This guide was changed in another window. Reload and try again.', revision: result.revision },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] PUT guide error:', err);
    // Odoo validation surfaces as a UserError message — pass it through (it's user-facing copy).
    const message = err instanceof Error ? err.message : 'Failed to save guide';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireRole('manager');
    const p = ids(params);
    if (!p) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertScope(user, p.templateId, p.lineId);
    const result = await deleteTemplateGuide(p.lineId);
    return NextResponse.json({ ok: true, revision: result.revision });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] DELETE guide error:', err);
    return NextResponse.json({ error: 'Failed to delete guide' }, { status: 500 });
  }
}
