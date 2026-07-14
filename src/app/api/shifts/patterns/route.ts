/**
 * GET  /api/shifts/patterns?company_id=  — list a company's weekly patterns.
 * POST /api/shifts/patterns              — create one { name, lines[] }.
 * Manager only. A pattern is a reusable weekly stencil (portal SQLite); publish
 * it into a week via POST /api/shifts/patterns/[id]/publish.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../_manager';
import { createPattern, listPatterns } from '@/lib/shifts-db';
import { parsePatternLines } from './_validate';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json({ patterns: listPatterns(auth.companyId) });
  } catch (err: unknown) {
    return serverError('GET patterns', err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;

    const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, 40);
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

    const parsed = parsePatternLines(body.lines);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const id = createPattern({ companyId: auth.companyId, name, lines: parsed.lines });
    return NextResponse.json({ ok: true, id });
  } catch (err: unknown) {
    return serverError('POST patterns', err);
  }
}
