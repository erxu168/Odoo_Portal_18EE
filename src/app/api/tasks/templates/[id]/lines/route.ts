import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { upsertTemplateLine, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireRole('manager');
    const templateId = parseInt(params.id, 10);
    if (Number.isNaN(templateId)) return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    const body = await req.json();
    if (!body.name || !body.day_part) {
      return NextResponse.json({ error: 'name and day_part are required' }, { status: 400 });
    }
    const lineId = await upsertTemplateLine(templateId, {
      name: body.name,
      sequence: body.sequence,
      day_part: body.day_part as DayPart,
      deadline_time: body.deadline_time ?? null,
      photo_required: !!body.photo_required,
      photo_instructions: body.photo_instructions ?? null,
      module_link_type: (body.module_link_type || 'none') as ModuleLink,
      subtasks: body.subtasks,
    });
    return NextResponse.json({ ok: true, line_id: lineId });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to add line';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
