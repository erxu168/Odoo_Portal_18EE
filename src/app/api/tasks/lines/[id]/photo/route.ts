import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { uploadLinePhoto } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    if (!body.data_base64 || !body.filename) {
      return NextResponse.json({ error: 'data_base64 and filename are required' }, { status: 400 });
    }
    const result = await uploadLinePhoto(id, body.filename, body.data_base64);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to upload photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
