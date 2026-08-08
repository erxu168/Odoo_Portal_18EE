export const dynamic = 'force-dynamic';
/**
 * GET/PUT /api/closing-report/settings — the per-restaurant morning-email
 * toggle (managers get an 08:00 email listing departments that missed last
 * night). Default OFF; a missing row means OFF.
 */
import { NextResponse } from 'next/server';
import { moduleForbidden } from '@/lib/module-access';
import { CAP } from '@/lib/closing-report/access';
import { authorize, initClosingTables, jsonError, resolveCompany } from '@/lib/closing-report/route-helpers';
import { getSettings, setMissingEmail } from '@/lib/closing-report/db';

export async function GET(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  return NextResponse.json({ company_id: companyId, ...getSettings(companyId) });
}

export async function PUT(request: Request) {
  const denied = moduleForbidden('closing-report');
  if (denied) return denied;
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initClosingTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');
  let body: { missing_email_enabled?: unknown };
  try { body = await request.json(); } catch { return jsonError(400, 'Bad request.'); }
  if (typeof body.missing_email_enabled !== 'boolean') return jsonError(400, 'Bad request.');
  setMissingEmail(companyId, body.missing_email_enabled);
  return NextResponse.json({ ok: true, company_id: companyId, ...getSettings(companyId) });
}
