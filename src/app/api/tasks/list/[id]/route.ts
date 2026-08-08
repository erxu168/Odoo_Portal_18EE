import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getListById } from '@/lib/odoo-tasks';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const list = await getListById(id);
    if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });
    // Being signed in used to be the whole check, so any staff member could
    // read any restaurant's day by guessing an id — task names, staff notes,
    // who completed what. 404 rather than 403: whose list this is is not
    // something to confirm to someone who cannot see it.
    if (!userCompanyAllowed(user, list.company_id)) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }
    return NextResponse.json({ list });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
