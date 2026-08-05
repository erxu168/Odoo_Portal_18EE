import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { reorderTemplateLines } from '@/lib/odoo-tasks';
import { assertTemplateCompany } from '@/lib/tasks-scope';
import { moduleForbidden } from '@/lib/module-access';

/**
 * Persist a drag-and-drop reorder of ONE day-part section's tasks.
 *
 * Body: { ordered_ids: number[] } — that section's line ids in their new order.
 * The whole section is sent, not a from/to pair, so the result does not depend
 * on the client and server agreeing about the previous order.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireCapability('tasks.template.manage');
    const templateId = parseInt(params.id, 10);
    if (Number.isNaN(templateId)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }
    // Tenant boundary: portal Odoo calls are sudo, so record rules don't apply —
    // the template must belong to the caller's company. (Odoo re-checks that the
    // lines belong to this template.)
    await assertTemplateCompany(user, templateId);

    const body = await req.json();
    const ids = Array.isArray(body?.ordered_ids) ? body.ordered_ids : null;
    if (!ids) {
      return NextResponse.json({ error: 'ordered_ids must be an array' }, { status: 400 });
    }
    if (!ids.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)) {
      return NextResponse.json({ error: 'ordered_ids must be positive integers' }, { status: 400 });
    }

    await reorderTemplateLines(templateId, ids as number[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to reorder tasks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
