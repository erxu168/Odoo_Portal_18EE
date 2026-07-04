import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { addAdHocLine, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('manager');
    const listId = parseInt(params.id, 10);
    if (Number.isNaN(listId)) return NextResponse.json({ error: 'Invalid list id' }, { status: 400 });
    const body = await req.json();
    if (!body.name || !body.day_part) {
      return NextResponse.json({ error: 'name and day_part are required' }, { status: 400 });
    }
    const lineId = await addAdHocLine(listId, {
      name: body.name,
      details: body.details ?? null,
      day_part: body.day_part as DayPart,
      deadline_datetime: body.deadline_datetime ?? null,
      photo_required: !!body.photo_required,
      photo_instructions: body.photo_instructions ?? null,
      module_link_type: (body.module_link_type || 'none') as ModuleLink,
    });
    return NextResponse.json({ ok: true, line_id: lineId });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to add task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
