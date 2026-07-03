/**
 * GET /api/shifts/punctuality?company_id=6&week=2026-W28
 * Manager-only. Per-employee late-in / left-early / overtime tallies for the
 * week, from hr.attendance matched to scheduled planning.slots.
 */
import { NextResponse } from 'next/server';
import { requireManagerCompany, resolveWeekKey, serverError } from '../_manager';
import { fetchWeekPunctuality } from '@/lib/shifts-punctuality';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const auth = requireManagerCompany(searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  const weekKey = resolveWeekKey(searchParams.get('week'));
  if (!weekKey) return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
  try {
    const result = await fetchWeekPunctuality(auth.companyId, weekKey);
    return NextResponse.json(result);
  } catch (err: unknown) {
    return serverError('punctuality', err);
  }
}
