/**
 * GET    /api/shifts/patterns/[id]?company_id=  — one pattern with its lines.
 * PUT    /api/shifts/patterns/[id]              — rename + replace lines { name, lines[] }.
 * DELETE /api/shifts/patterns/[id]?company_id=  — soft-delete a pattern.
 * Manager only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../../_manager';
import { deletePattern, getPattern, replacePatternLines } from '@/lib/shifts-db';
import { parsePatternLines } from '../_validate';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const id = parseId(params.id);
    if (id === null) return NextResponse.json({ error: 'Invalid pattern id' }, { status: 400 });
    const pattern = getPattern(id, auth.companyId);
    if (!pattern) return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
    return NextResponse.json({ pattern });
  } catch (err: unknown) {
    return serverError('GET patterns/[id]', err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;

    const id = parseId(params.id);
    if (id === null) return NextResponse.json({ error: 'Invalid pattern id' }, { status: 400 });

    const name = (typeof body.name === 'string' ? body.name.trim() : '').slice(0, 40);
    if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

    const parsed = parsePatternLines(body.lines);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const ok = replacePatternLines(id, auth.companyId, name, parsed.lines);
    if (!ok) return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('PUT patterns/[id]', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const id = parseId(params.id);
    if (id === null) return NextResponse.json({ error: 'Invalid pattern id' }, { status: 400 });
    const ok = deletePattern(id, auth.companyId);
    if (!ok) return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('DELETE patterns/[id]', err);
  }
}
