import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getGuideScope } from '@/lib/odoo-tasks';
import { getStepMedia } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

async function assertScope(user: PortalUser, guideId: number): Promise<void> {
  const scope = await getGuideScope(guideId);
  if (!scope) throw new AuthError('Not found', 404);
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length && (scope.companyId === null || !allowed.includes(scope.companyId))) {
    throw new AuthError('Forbidden', 403);
  }
}

// GET — a library guide step's photo or PDF bytes for the manager editor.
export async function GET(
  _req: NextRequest,
  { params }: { params: { guideId: string; stepId: string } },
) {
  try {
    const user = requireRole('manager');
    const guideId = parseInt(params.guideId, 10);
    const stepId = parseInt(params.stepId, 10);
    if (Number.isNaN(guideId) || Number.isNaN(stepId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await assertScope(user, guideId);
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const media = await getStepMedia('guide', stepId, allowed, guideId);
    if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(media.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': media.mimetype || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET guide media error:', err);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }
}
