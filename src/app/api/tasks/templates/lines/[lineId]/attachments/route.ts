import { NextRequest, NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { addTemplateLineAttachment } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest, { params }: { params: { lineId: string } }) {
  try {
    requireRole('manager');
    const lineId = parseInt(params.lineId, 10);
    if (Number.isNaN(lineId)) return NextResponse.json({ error: 'Invalid line id' }, { status: 400 });
    const body = await req.json();
    if (!body.name || !body.data_base64) {
      return NextResponse.json({ error: 'name and data_base64 are required' }, { status: 400 });
    }
    const id = await addTemplateLineAttachment(lineId, body.name, body.data_base64, body.mimetype || '');
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to add attachment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
