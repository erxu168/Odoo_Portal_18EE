export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getEvents } from '@/lib/shift-handover/queries';

// GET — the canonical append-only audit trail for this restaurant.
export async function GET(request: Request) {
  const authz = authorize(CAP.historyView);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  const p = new URL(request.url).searchParams;
  const events = getEvents([companyId], {
    entity_type: p.get('entity_type') || undefined,
    entity_id: p.get('entity_id') ? parseInt(p.get('entity_id')!, 10) : undefined,
    limit: p.get('limit') ? parseInt(p.get('limit')!, 10) : undefined,
  });
  return NextResponse.json({ events });
}
