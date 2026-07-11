import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { updateLine, deleteAdHocLine, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    await updateLine(id, {
      name: body.name,
      day_part: body.day_part as DayPart,
      deadline_datetime: body.deadline_datetime,
      photo_required: body.photo_required,
      module_link_type: body.module_link_type as ModuleLink,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to update task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireCapability('tasks.template.manage');
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await deleteAdHocLine(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to delete task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
