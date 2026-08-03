/**
 * GET /api/tasks/review?date=YYYY-MM-DD&staff=<employeeId>
 *
 * Manager photo-review feed: the day's completed tasks that carry a proof photo,
 * in the manager's companies (fails closed on an empty scope), newest first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { readReviewFeed } from '@/lib/task-review';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const user = requireRole('manager');
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const staffParam = url.searchParams.get('staff');
    const date = dateParam && DATE_RE.test(dateParam) ? dateParam : undefined;
    const staff = staffParam && /^\d+$/.test(staffParam) ? parseInt(staffParam, 10) : undefined;
    const feed = await readReviewFeed(allowed, date, staff);
    const res = NextResponse.json(feed);
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET /api/tasks/review error:', err);
    return NextResponse.json({ error: 'Could not load the photo review.' }, { status: 500 });
  }
}
