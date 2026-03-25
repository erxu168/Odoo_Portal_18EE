import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';
import { DOCUMENT_TYPES } from '@/types/hr';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const docId = parseInt(id);
    if (!docId) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const docs = await odoo.read('documents.document', [docId], [
      'name', 'mimetype', 'file_size', 'datas', 'res_model', 'res_id',
    ]);

    if (!docs || docs.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const doc = docs[0];

    if (doc.res_model !== 'hr.employee') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (doc.res_id !== user.employee_id && !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (!doc.datas) {
      return NextResponse.json({ error: 'Document has no content' }, { status: 404 });
    }

    return NextResponse.json({
      id: doc.id,
      name: doc.name,
      mimetype: doc.mimetype,
      file_size: doc.file_size,
      data_base64: doc.datas,
    });
  } catch (err: unknown) {
    console.error('GET /api/hr/documents/[id] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch document' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const docId = parseInt(id);
    if (!docId) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    // Fetch the doc to verify ownership and get metadata for logging
    const docs = await odoo.read('documents.document', [docId], [
      'name', 'res_model', 'res_id', 'tag_ids',
    ]);

    if (!docs || docs.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const doc = docs[0];

    if (doc.res_model !== 'hr.employee') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const targetId = doc.res_id as number;
    if (targetId !== user.employee_id && !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Resolve doc type label for logging
    const tagIds: number[] = (doc.tag_ids as number[]) || [];
    const tagIdToType: Record<number, typeof DOCUMENT_TYPES[number]> = {};
    for (const dt of DOCUMENT_TYPES) {
      tagIdToType[dt.tagId] = dt;
    }
    const docType = tagIds.map((tid) => tagIdToType[tid]).find(Boolean);
    const docTypeLabel = docType
      ? `${docType.label} (${docType.labelDe})`
      : 'Unknown type';

    // Archive the document (soft delete)
    await odoo.write('documents.document', [docId], { active: false });

    // Log the deletion in Odoo chatter
    try {
      const logBody = `<p><strong>Document deleted: ${docTypeLabel}</strong></p>`
        + `<p>File: ${doc.name}</p>`
        + `<p><em>Deleted via Staff Portal by ${user.name || user.email}</em></p>`;

      await odoo.call('hr.employee', 'message_post', [[targetId]], {
        body: logBody,
        message_type: 'comment',
        subtype_xmlid: 'mail.mt_note',
      });
    } catch (logErr) {
      console.error('Failed to log document deletion:', logErr);
    }

    return NextResponse.json({ success: true, archived_id: docId });
  } catch (err: unknown) {
    console.error('DELETE /api/hr/documents/[id] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete document' },
      { status: 500 }
    );
  }
}
