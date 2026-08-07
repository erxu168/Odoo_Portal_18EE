import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getAttachmentData } from '@/lib/odoo-tasks';
import { parseCompanyIds } from '@/lib/db';
import { moduleForbidden } from '@/lib/module-access';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    // Same scope as the bytes route beside this one — two doors to the same
    // attachment, so a check on one of them is no check at all.
    const data = await getAttachmentData(id, parseCompanyIds(user.allowed_company_ids));
    if (!data) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load attachment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
