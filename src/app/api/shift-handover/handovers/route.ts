export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { listHandoverHistory } from '@/lib/shift-handover/queries';

// GET — handover list / history for the current restaurant.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const p = new URL(request.url).searchParams;
  const handovers = listHandoverHistory([companyId], {
    status: p.get('status') || undefined,
    from: p.get('from') || undefined,
    to: p.get('to') || undefined,
    limit: p.get('limit') ? parseInt(p.get('limit')!, 10) : undefined,
  });
  return NextResponse.json({ handovers });
}
