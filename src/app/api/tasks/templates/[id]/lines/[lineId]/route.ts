import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { upsertTemplateLine, deleteTemplateLine, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    requireRole('manager');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
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
    requireRole('manager');
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid line id' }, { status: 400 });
    await deleteTemplateLine(lineId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to delete line';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
