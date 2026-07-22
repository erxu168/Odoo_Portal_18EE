export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/templates/[id] — a single counting list (template) by id,
 * for its canonical page (/inventory/list/[id]). Scoped to the caller's
 * restaurant(s): a list belonging to another company returns 404.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { initInventoryTables, getTemplate } from '@/lib/inventory-db';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const id = /^\d+$/.test(params.id) ? parseInt(params.id, 10) : NaN;
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid list id' }, { status: 400 });

  const tmpl = getTemplate(id);
  if (!tmpl) return NextResponse.json({ error: 'List not found' }, { status: 404 });

  // Scope by the list's company. A null-company legacy (orphan) list is
  // manageable by any ADMIN (cross-company by design) so it can be re-tagged or
  // cleaned up — a company-scoped admin is still an admin; a manager cannot.
  const allowed = parseCompanyIds(user.allowed_company_ids);
  const adminUnrestricted = user.role === 'admin' && allowed.length === 0;
  if (tmpl.company_id == null) {
    if (user.role !== 'admin') return NextResponse.json({ error: 'List not found' }, { status: 404 });
  } else if (!adminUnrestricted && !allowed.includes(tmpl.company_id)) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 });
  }

  return NextResponse.json({ template: tmpl });
}
