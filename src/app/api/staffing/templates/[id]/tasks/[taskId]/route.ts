/**
 * Staff Lifecycle Checklists — one master task.
 * PATCH/DELETE /api/staffing/templates/[id]/tasks/[taskId]  (admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { getTemplate, updateTemplateTask, deleteTemplateTask } from '@/lib/staffing-checklist-db';
import { assigneeError } from '@/lib/staffing-odoo';
import type { UpsertTemplateTaskInput } from '@/types/staffing';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = (await req.json()) as UpsertTemplateTaskInput;
    if (!b.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (b.audience === 'business' && b.responsible_type === 'the_employee') {
      return NextResponse.json({ error: 'Only Employee tasks can be assigned to the employee.' }, { status: 400 });
    }
    if (b.reminder && (b.due_offset_days == null)) {
      return NextResponse.json({ error: 'A reminder needs a deadline.' }, { status: 400 });
    }
    const aErr = assigneeError(b.responsible_type, b.responsible_user_id, tpl.company_id);
    if (aErr) return NextResponse.json({ error: aErr }, { status: 400 });
    // Scope the task to its template so a mismatched (A-template, B-task) pair can't cross companies.
    const ok = updateTemplateTask(Number(params.taskId), tpl.id, { ...b, title: b.title.trim() });
    if (!ok) return NextResponse.json({ error: 'Task not found in this checklist' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] PATCH template task', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  try {
    const user = requireCapability('staffing.templates.manage');
    const tpl = getTemplate(Number(params.id));
    if (!tpl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canAccessCompany(user, tpl.company_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const ok = deleteTemplateTask(Number(params.taskId), tpl.id);
    if (!ok) return NextResponse.json({ error: 'Task not found in this checklist' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] DELETE template task', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
