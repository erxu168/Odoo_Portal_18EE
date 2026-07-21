import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getTemplateSetupPhoto, getSetupPhotoBySeq } from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';

// GET — serve a TEMPLATE line's reference photo by line id alone, company-scoped
// in the addon. `?seq=N` picks one photo of a multi-photo guide (default: first).
// Used by the manager editor/preview. Any authenticated user in the template's company.
export async function GET(req: NextRequest, { params }: { params: { lineId: string } }) {
  try {
    const user = requireAuth();
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const seqRaw = req.nextUrl.searchParams.get('seq');
    const companies = parseCompanyIds(user.allowed_company_ids);
    const photo = seqRaw !== null && !Number.isNaN(parseInt(seqRaw, 10))
      ? await getSetupPhotoBySeq('template', lineId, parseInt(seqRaw, 10), companies)
      : await getTemplateSetupPhoto(lineId, companies);
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
