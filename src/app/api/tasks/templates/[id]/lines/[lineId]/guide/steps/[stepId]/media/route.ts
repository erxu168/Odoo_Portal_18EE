import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { templateLineBelongsToTemplate, getTemplateCompany } from '@/lib/odoo-tasks';
import { getStepMedia } from '@/lib/task-guide';

export const dynamic = 'force-dynamic';

// GET — serve a template guide step's photo or PDF bytes (manager editor preview).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; lineId: string; stepId: string } },
) {
  try {
    const user = requireRole('manager');
    const templateId = parseInt(params.id, 10);
    const lineId = parseInt(params.lineId, 10);
    const stepId = parseInt(params.stepId, 10);
    if ([templateId, lineId, stepId].some(Number.isNaN)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    if (!(await templateLineBelongsToTemplate(templateId, lineId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const company = await getTemplateCompany(templateId);
    const allowed = parseCompanyIds(user.allowed_company_ids);
    if (allowed.length && company !== null && !allowed.includes(company)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Pass the guide's own company so the fail-closed get_media serves it even
    // for an admin whose allowed-company list is empty (= all companies).
    const media = await getStepMedia('template', stepId, company !== null ? [company] : []);
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
    console.error('[tasks] GET template guide media error:', err);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }
}
