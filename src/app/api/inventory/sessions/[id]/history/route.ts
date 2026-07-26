export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/sessions/[id]/history
 * What the products in this count came out at the last few APPROVED times.
 * Reviewer context only — never used to change a number automatically.
 * Returns: { history: { [product_id]: { qty, date }[] } }
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  initInventoryTables, getSession, getSessionEntries, getSessionItems, getProductCountHistory,
} from '@/lib/inventory-db';
import { canAccessSession, canAccessCompany } from '@/lib/inventory-access';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const id = parseInt(params.id, 10);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!canAccessSession(user, session)) {
    return NextResponse.json({ error: 'This count belongs to another restaurant' }, { status: 403 });
  }
  // Reaching ONE session is not the same as reaching a restaurant's whole count
  // history. canAccessSession lets an explicitly assigned staffer in even after
  // they have moved companies; this endpoint hands back months of that
  // restaurant's numbers, so it asks the stricter question separately.
  if (!session.company_id || !canAccessCompany(user, session.company_id)) {
    return NextResponse.json({ history: {} });
  }

  // Which products this count is about — the frozen snapshot when there is one,
  // otherwise whatever was actually entered.
  const snapshot = getSessionItems(id);
  const productIds = snapshot.length > 0
    ? Array.from(new Set(snapshot.map((it: any) => it.odoo_product_id)))
    : Array.from(new Set(getSessionEntries(id).map((e: any) => e.product_id)));

  const history = getProductCountHistory(session.company_id, productIds, { excludeSessionId: id });
  return NextResponse.json({ history });
}
