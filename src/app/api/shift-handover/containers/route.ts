export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getStorageOverview } from '@/lib/shift-handover/queries';

// GET — live storage overview, grouped by location. Optional filters via query.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const p = new URL(request.url).searchParams;
  const num = (k: string) => (p.get(k) ? parseInt(p.get(k)!, 10) : undefined);
  const groups = getStorageOverview(companyId, {
    product_id: num('product_id'),
    storage_location_id: num('location_id'),
    availability_state: p.get('availability') || undefined,
    preparation_state: p.get('preparation') || undefined,
    use_first: p.get('use_first') === '1' ? true : undefined,
  });
  return NextResponse.json({ groups });
}
