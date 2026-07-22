export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { ensureDefaultLogTypes, listLogTypes, createLogType, nextTypeSortOrder } from '@/lib/shift-handover/db';

// GET — the log types for the manager setup screen.
export async function GET(request: Request) {
  const authz = authorize(CAP.view);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  ensureDefaultLogTypes(companyId);
  const types = listLogTypes(companyId).map((t) => ({
    id: t.id, name: t.name, emoji: t.emoji, is_alert: !!t.is_alert, is_storage: !!t.is_storage, sort_order: t.sort_order,
  }));
  return NextResponse.json({ types });
}

// POST — a manager adds a new type (name + emoji, optionally an alert type).
export async function POST(request: Request) {
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const emoji = typeof body?.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : '📝';
  if (!name) return jsonError(400, 'Give the type a name.');

  const id = createLogType({ company_id: companyId, name, emoji, is_alert: !!body?.is_alert, sort_order: nextTypeSortOrder(companyId) });
  return NextResponse.json({ type_id: id });
}
