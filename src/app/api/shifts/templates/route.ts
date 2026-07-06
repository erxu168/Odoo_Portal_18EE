/**
 * GET  /api/shifts/templates?company_id=  — list a company's shift templates.
 * POST /api/shifts/templates              — create one { name, start, end, role_id?, headcount? }.
 * Manager only. Templates are reusable "quick start" shifts (portal SQLite).
 */
import { NextResponse } from 'next/server';
import { normalizeHHMM, requireManagerCompany, serverError } from '../_manager';
import { createShiftTemplate, listShiftTemplates } from '@/lib/shifts-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json({ templates: listShiftTemplates(auth.companyId) });
  } catch (err: unknown) {
    return serverError('GET templates', err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;

    const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, 40);
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });
    const start = normalizeHHMM(body.start);
    const end = normalizeHHMM(body.end);
    if (!start || !end) {
      return NextResponse.json({ error: 'Valid start and end times are required' }, { status: 400 });
    }
    const roleId = typeof body.role_id === 'number' && body.role_id > 0 ? body.role_id : null;
    const headcount =
      Number.isInteger(body.headcount) && (body.headcount as number) >= 1 && (body.headcount as number) <= 20
        ? (body.headcount as number)
        : 1;

    const id = createShiftTemplate({ companyId: auth.companyId, name, startHHMM: start, endHHMM: end, roleId, headcount });
    return NextResponse.json({ ok: true, id });
  } catch (err: unknown) {
    return serverError('POST templates', err);
  }
}
