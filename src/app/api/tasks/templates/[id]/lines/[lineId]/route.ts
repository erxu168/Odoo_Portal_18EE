import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { upsertTemplateLine, deleteTemplateLine, templateLineBelongsToTemplate, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // The line must already belong to this template — prevents moving/editing an
    // arbitrary line via a mismatched URL (upsertTemplateLine rewrites template_id).
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    await upsertTemplateLine(templateId, {
      id: lineId,
      name: body.name,
      sequence: body.sequence,
      day_part: body.day_part as DayPart,
      deadline_time: body.deadline_time,
      photo_required: !!body.photo_required,
      photo_instructions: body.photo_instructions ?? null,
      module_link_type: (body.module_link_type || 'none') as ModuleLink,
      subtasks: body.subtasks,
      recurrence: body.recurrence,
      is_setup_guide: body.is_setup_guide,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to update line';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await deleteTemplateLine(lineId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to delete line';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
