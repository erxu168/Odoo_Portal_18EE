import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getListLineSetupPhoto } from '@/lib/setup-guide';

export const dynamic = 'force-dynamic';

// GET — serve a daily line's OWN snapshot reference photo as raw image bytes.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireAuth();
    const lineId = parseInt(params.id, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const photo = await getListLineSetupPhoto(lineId);
    if (!photo) return NextResponse.json({ error: 'No photo' }, { status: 404 });
    const buf = Buffer.from(photo.data_base64, 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: { 'Content-Type': photo.mimetype || 'image/jpeg', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
