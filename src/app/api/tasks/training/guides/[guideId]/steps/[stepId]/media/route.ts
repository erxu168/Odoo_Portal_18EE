import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError, type PortalUser } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getGuideScope } from '@/lib/odoo-tasks';
import { getStepMedia } from '@/lib/task-guide';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

/** Same gate as the training read: PUBLISHED + in the staff member's companies. */
async function assertStaffScope(user: PortalUser, guideId: number): Promise<void> {
  const scope = await getGuideScope(guideId);
  if (!scope || !scope.published) throw new AuthError('Not found', 404);
  if (!userCompanyAllowed(user, scope.companyId)) throw new AuthError('Not found', 404);
}

// GET — a published guide step's photo or PDF bytes for the staff Training player.
export async function GET(
  _req: NextRequest,
  { params }: { params: { guideId: string; stepId: string } },
) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const guideId = parseInt(params.guideId, 10);
    const stepId = parseInt(params.stepId, 10);
    if (Number.isNaN(guideId) || Number.isNaN(stepId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await assertStaffScope(user, guideId);
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
    console.error('[tasks] GET training guide media error:', err);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }
}
