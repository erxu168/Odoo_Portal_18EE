import { NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listLibraryGuides } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

// GET — PUBLISHED guides in the staff member's companies, for the Training area.
// Drafts never appear here (managers see them in the Library).
export async function GET() {
  try {
    const user = requireAuth();
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const guides = (await listLibraryGuides(allowed))
      .filter(g => g.published && g.step_count > 0)
      .map(g => ({ id: g.id, name: g.name, step_count: g.step_count }));
    const res = NextResponse.json({ guides });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET training guides error:', err);
    return NextResponse.json({ error: 'Failed to load training guides' }, { status: 500 });
  }
}
