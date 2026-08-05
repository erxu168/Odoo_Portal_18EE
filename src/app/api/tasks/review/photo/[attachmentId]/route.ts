/**
 * GET /api/tasks/review/photo/{attachmentId}
 *
 * Serves a proof photo's bytes for the manager review screen. Scoped in Odoo:
 * the attachment must be a proof photo on a daily line in the manager's company.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getReviewPhoto } from '@/lib/task-review';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { attachmentId: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireRole('manager');
    const id = parseInt(params.attachmentId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const allowed = parseCompanyIds(user.allowed_company_ids);
    const media = await getReviewPhoto(id, allowed);
    if (!media || !media.data_base64) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(media.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': media.mimetype || 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET review photo error:', err);
    return NextResponse.json({ error: 'Could not load the photo.' }, { status: 500 });
  }
}
