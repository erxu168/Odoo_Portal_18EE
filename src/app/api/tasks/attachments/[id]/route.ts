import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireCapability, AuthError } from '@/lib/auth';
import { deleteAttachment, getAttachmentData } from '@/lib/odoo-tasks';
import { parseCompanyIds } from '@/lib/db';
import { moduleForbidden } from '@/lib/module-access';

// GET — raw bytes of a task attachment, so it can be shown directly in an <img>
// (thumbnail) or served to the browser. Same auth as the /data JSON endpoint.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    // Scoped to the caller's restaurants. Being signed in used to be enough:
    // the id was the only thing standing between one company's task files and
    // everybody else's. 404, not 403 — a refusal that distinguishes "not yours"
    // from "does not exist" is itself a way to enumerate ids.
    const data = await getAttachmentData(id, parseCompanyIds(user.allowed_company_ids));
    if (!data || !data.data_base64) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(Buffer.from(data.data_base64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': data.mimetype || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Failed to load attachment' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('tasks');
  if (denied) return denied;

  try {
    const user = requireCapability('tasks.template.manage');
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    // This used to unlink ir.attachment by raw id, so the capability to manage
    // task templates was also the capability to delete any attachment in the
    // database — an invoice, a contract, a payslip.
    if (!(await deleteAttachment(id, parseCompanyIds(user.allowed_company_ids)))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to delete attachment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
