import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getTemplateSetupPhoto } from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';

// GET — serve a TEMPLATE line's reference photo by line id alone, company-scoped
// in the addon. Used by the manager preview (which only has the template line id,
// not the template id). Any authenticated user in the template's company.
export async function GET(_req: NextRequest, { params }: { params: { lineId: string } }) {
  try {
    const user = requireAuth();
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const photo = await getTemplateSetupPhoto(lineId, parseCompanyIds(user.allowed_company_ids));
    if (!photo) return NextResponse.json({ error: 'No photo' }, { status: 404 });
    const buf = Buffer.from(photo.data_base64, 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': photo.mimetype || 'image/jpeg',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
