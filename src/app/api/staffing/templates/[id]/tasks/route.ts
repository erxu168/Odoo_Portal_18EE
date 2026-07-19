/**
 * Staff Lifecycle Checklists — tasks within a master template.
 * GET  /api/staffing/templates/[id]/tasks  → list (admin)
 * POST /api/staffing/templates/[id]/tasks  → add (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getTemplate, addTemplateTask, listTemplateTasks } from '@/lib/staffing-checklist-db';
import type { UpsertTemplateTaskInput } from '@/types/staffing';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ tasks: listTemplateTasks(tpl.id) });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET template tasks', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = (await req.json()) as UpsertTemplateTaskInput;
    if (!b.title?.trim() || !b.audience || !b.responsible_type) {
      return NextResponse.json({ error: 'title, audience and responsible are required' }, { status: 400 });
    }
    if (b.audience === 'business' && b.responsible_type === 'the_employee') {
      return NextResponse.json({ error: 'Only Employee tasks can be assigned to the employee.' }, { status: 400 });
    }
    if (b.reminder && (b.due_offset_days == null)) {
      return NextResponse.json({ error: 'A reminder needs a deadline.' }, { status: 400 });
    }
    const id = addTemplateTask(tpl.id, { ...b, title: b.title.trim() });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST template task', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
