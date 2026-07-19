/**
 * Staff Lifecycle Checklists — atomic bulk reorder of a template's tasks.
 * POST /api/staffing/templates/[id]/tasks/reorder  body: { orderedIds: number[] }  (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getTemplate, reorderTemplateTasks } from '@/lib/staffing-checklist-db';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json();
    const orderedIds: number[] = Array.isArray(b.orderedIds) ? b.orderedIds.map(Number).filter(Number.isFinite) : [];
    reorderTemplateTasks(tpl.id, orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST reorder', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
