/**
 * Staff Lifecycle Checklists — single master template.
 * GET/PATCH/DELETE /api/staffing/templates/[id]  (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getTemplate, updateTemplate, deleteTemplate, listTemplateTasks } from '@/lib/staffing-checklist-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ template: tpl, tasks: listTemplateTasks(tpl.id) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET template', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await req.json();
    updateTemplate(tpl.id, { name: b.name, active: b.active });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] PATCH template', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    deleteTemplate(tpl.id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] DELETE template', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
