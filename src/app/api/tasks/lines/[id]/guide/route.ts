import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { readListGuide } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

// GET — the daily line's guide snapshot for the staff player. Company-scoped
// (fails closed in the model). Media bytes come via the step-media route.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    const lineId = parseInt(params.id, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const guide = await readListGuide(lineId, allowed);
    if (!guide) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const res = NextResponse.json(guide);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET line guide error:', err);
    return NextResponse.json({ error: 'Failed to load guide' }, { status: 500 });
  }
}
