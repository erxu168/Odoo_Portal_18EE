import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { DOCUMENT_TYPES } from '@/types/hr';

/**
 * May `user` read/delete the hr.employee document owned by `targetEmployeeId`?
 * Self is always allowed. Otherwise the caller must be a manager AND — because
 * portal roles are global — share a company with the target employee, so a
 * manager of one restaurant cannot reach another restaurant's staff documents.
 * Admins are cross-company by design (matches the rest of the app).
 */
async function canAccessEmployeeDoc(
  user: NonNullable<ReturnType<typeof getCurrentUser>>,
  targetEmployeeId: number,
): Promise<boolean> {
  if (targetEmployeeId === user.employee_id) return true;
  if (!hasRole(user, 'manager')) return false;
  if (user.role === 'admin') return true;
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length === 0) return false;
  const emps = await getOdoo().read('hr.employee', [targetEmployeeId], ['company_id']);
  const cid = emps?.[0]?.company_id;
  const companyId = Array.isArray(cid) ? (cid[0] as number) : typeof cid === 'number' ? cid : null;
  return companyId !== null && allowed.includes(companyId);
}

/** Maps doc type key → employee field that tracks admin confirmation */
const DOC_CONFIRMED_FIELD: Record<string, string> = {
  ausweis: 'kw_doc_ausweis_ok',
  steuer_id: 'kw_doc_steuer_id_ok',
  sv_ausweis: 'kw_doc_sv_ausweis_ok',
  gesundheitszeugnis: 'kw_doc_gesundheitszeugnis_ok',
  aufenthaltstitel: 'kw_doc_aufenthaltstitel_ok',
  krankenkasse: 'kw_doc_krankenkasse_ok',
  lohnsteuer: 'kw_doc_lohnsteuer_ok',
  vertrag: 'kw_doc_vertrag_ok',
};

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

    const odoo = getOdoo();

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

    if (!(await canAccessEmployeeDoc(user, doc.res_id as number))) {
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

    const odoo = getOdoo();

    // Fetch the doc to verify ownership and get metadata
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
    if (!(await canAccessEmployeeDoc(user, targetId))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Resolve doc type from tags
    const tagIds: number[] = (doc.tag_ids as number[]) || [];
    const tagIdToType: Record<number, typeof DOCUMENT_TYPES[number]> = {};
    for (const dt of DOCUMENT_TYPES) {
      tagIdToType[dt.tagId] = dt;
    }
    const docType = tagIds.map((tid) => tagIdToType[tid]).find(Boolean);
    const docTypeKey = docType?.key || '';
    const docTypeLabel = docType
      ? `${docType.label} (${docType.labelDe})`
      : 'Unknown type';

    // Check if this doc type has been admin-confirmed — only admin/manager can delete confirmed docs
    const confirmedField = DOC_CONFIRMED_FIELD[docTypeKey];
    if (confirmedField && !hasRole(user, 'manager')) {
      // Read the employee record to check confirmation status
      const employees = await odoo.searchRead('hr.employee', [
        ['id', '=', targetId],
      ], [confirmedField], { limit: 1 });

      if (employees && employees.length > 0 && employees[0][confirmedField]) {
        return NextResponse.json(
          { error: 'This document has been verified by an admin and cannot be deleted. Contact your manager if you need to replace it.' },
          { status: 403 }
        );
      }
    }

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
