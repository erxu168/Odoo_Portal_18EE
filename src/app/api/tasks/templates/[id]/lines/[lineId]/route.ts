import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { upsertTemplateLine, deleteTemplateLine, templateLineBelongsToTemplate, getTemplateLineGuideMeta, type DayPart, type ModuleLink } from '@/lib/odoo-tasks';
import { assertTemplateCompany } from '@/lib/tasks-scope';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; lineId: string } }) {
  try {
    const user = requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // Tenant boundary (portal calls are sudo): the template must be in-company,
    // and the line must belong to it — prevents editing another company's line
    // (upsertTemplateLine rewrites template_id).
    await assertTemplateCompany(user, templateId);
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    // A guide must keep >=1 pin. Compute the EFFECTIVE post-write state: the flag
    // and pin count come from the request when provided, else from the persisted
    // line. This blocks (a) enabling guide mode on a pinless line while omitting
    // subtasks, and (b) subtasks:[] silently emptying an existing guide, while
    // still allowing a metadata-only PATCH that omits subtasks. Truthy (not ===)
    // matches how the flag is coerced to bool on persist.
    const flagProvided = body.is_setup_guide !== undefined;
    const subsProvided = Array.isArray(body.subtasks);
    const providedPinCount = subsProvided
      ? body.subtasks.filter((s: { name?: string }) => s?.name?.trim()).length
      : null;
    let effectiveGuide = flagProvided ? !!body.is_setup_guide : null;
    let effectivePins: number | null = providedPinCount;
    if (effectiveGuide === null || effectivePins === null) {
      const meta = await getTemplateLineGuideMeta(lineId);
      if (effectiveGuide === null) effectiveGuide = meta.isGuide;
      if (effectivePins === null) effectivePins = meta.pinCount;
    }
    if (effectiveGuide && effectivePins === 0) {
      return NextResponse.json({ error: 'A setup guide needs at least one pin' }, { status: 400 });
    }
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
    const user = requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(templateId) || Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    await assertTemplateCompany(user, templateId);
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
