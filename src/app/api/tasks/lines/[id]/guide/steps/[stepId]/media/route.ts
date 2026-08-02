import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getStepMedia } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

// GET — a daily guide step's photo or PDF bytes for the staff player.
// Company-scoped through the caller's allowed companies (fails closed).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  try {
    const user = requireAuth();
    const lineId = parseInt(params.id, 10);
    const stepId = parseInt(params.stepId, 10);
    if (Number.isNaN(lineId) || Number.isNaN(stepId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const allowed = parseCompanyIds(user.allowed_company_ids);
    // parentId=lineId → the step must belong to THIS daily line (not just any
    // same-company snapshot step), closing a step-id substitution gap.
    const media = await getStepMedia('list', stepId, allowed, lineId);
    if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(media.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': media.mimetype || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET line guide media error:', err);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }
}
