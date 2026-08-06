import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { subtaskPhoto } from '@/lib/odoo-tasks';
import { moduleForbidden } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

/** A TEMPLATE subtask's reference photo, for the manager's editor. Company-scoped, fails closed.
 *  parent_line_id is passed so a same-company subtask id cannot be substituted
 *  to read a photo belonging to a different task. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; lineId: string; subtaskId: string } },
) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;
  try {
    const user = requireAuth();
    const lineId = parseInt(params.lineId, 10);
    const subtaskId = parseInt(params.subtaskId, 10);
    if (Number.isNaN(lineId) || Number.isNaN(subtaskId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const photo = await subtaskPhoto('template', subtaskId, parseCompanyIds(user.allowed_company_ids), lineId);
    if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(photo.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': photo.mimetype || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[tasks] GET subtask photo error:', err);
    return NextResponse.json({ error: 'Failed to load photo' }, { status: 500 });
  }
}
