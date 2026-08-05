import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { berlinToday } from '@/lib/berlin-date';
import { completeLine, uncompleteLine, getListLineScope } from '@/lib/odoo-tasks';
import { resolveAttribution } from '@/lib/shift-attribution';
import { moduleForbidden } from '@/lib/module-access';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    // On a shared device this credits the "Working as" person, not the account.
    const { employeeId } = resolveAttribution(user);
    if (!employeeId) {
      return NextResponse.json({ error: 'No employee record linked' }, { status: 409 });
    }
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const result = await completeLine(id, employeeId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to complete task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — un-check a task (toggle completion off). Symmetric with POST: any
// signed-in user may undo a completion on TODAY's list (so an accidental check
// can be tapped off), scoped to their company. Past-day lists stay read-only.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const scope = await getListLineScope(id);
    if (!scope) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const allowed = parseCompanyIds(user.allowed_company_ids);
    if (allowed.length && scope.companyId && !allowed.includes(scope.companyId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (scope.date && scope.date < berlinToday()) {
      return NextResponse.json({ error: 'Past task lists are read-only' }, { status: 403 });
    }
    await uncompleteLine(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to undo completion';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
