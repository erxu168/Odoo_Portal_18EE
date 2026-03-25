import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { OdooClient } from '@/lib/odoo';
import { DOCUMENT_TYPES, HR_FOLDER_ID } from '@/types/hr';

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const employeeId = parseInt(searchParams.get('employee_id') || '0');

    const targetId = employeeId || user.employee_id;
    if (targetId !== user.employee_id && !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    const docs = await odoo.searchRead('documents.document', [
      ['res_model', '=', 'hr.employee'],
      ['res_id', '=', targetId],
      ['type', '=', 'binary'],
    ], [
      'name', 'mimetype', 'file_size', 'tag_ids', 'create_date',
      'checksum', 'write_date',
    ]);

    const tagIdToKey: Record<number, string> = {};
    for (const dt of DOCUMENT_TYPES) {
      tagIdToKey[dt.tagId] = dt.key;
    }

    const enriched = (docs || []).map((doc: Record<string, unknown>) => {
      const tagIds: number[] = (doc.tag_ids as number[]) || [];
      const docTypeKey = tagIds
        .map((id: number) => tagIdToKey[id])
        .find((k: string | undefined) => k) || 'other';
      return {
        id: doc.id,
        name: doc.name,
        mimetype: doc.mimetype,
        file_size: doc.file_size,
        size_kb: Math.round(((doc.file_size as number) || 0) / 1024),
        tag_ids: doc.tag_ids,
        doc_type_key: docTypeKey,
        create_date: doc.create_date,
        write_date: doc.write_date,
      };
    });

    return NextResponse.json({ documents: enriched });
  } catch (err: unknown) {
    console.error('GET /api/hr/documents error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser();
    if (!user || !user.employee_id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { employee_id, doc_type_key } = body;

    const docType = DOCUMENT_TYPES.find(dt => dt.key === doc_type_key);
    if (!docType) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 });
    }

    // Support both single file (legacy) and multi-file upload
    const files: { filename: string; data_base64: string }[] = body.files
      ? body.files
      : body.filename && body.data_base64
        ? [{ filename: body.filename, data_base64: body.data_base64 }]
        : [];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Validate all files
    for (const file of files) {
      if (!file.filename || !file.data_base64) {
        return NextResponse.json({ error: 'Each file must have filename and data_base64' }, { status: 400 });
      }
      const sizeBytes = Math.ceil(file.data_base64.length * 0.75);
      if (sizeBytes > 5 * 1024 * 1024) {
        return NextResponse.json({ error: `File ${file.filename} too large (max 5MB per file)` }, { status: 400 });
      }
    }

    const targetId = employee_id || user.employee_id;
    if (targetId !== user.employee_id && !hasRole(user, 'manager')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const odoo = new OdooClient();
    await odoo.authenticate();

    // Archive existing docs for this type (replace)
    const existing = await odoo.searchRead('documents.document', [
      ['res_model', '=', 'hr.employee'],
      ['res_id', '=', targetId],
      ['tag_ids', 'in', [docType.tagId]],
      ['type', '=', 'binary'],
    ], ['id']);

    if (existing && existing.length > 0) {
      const oldIds = existing.map((d: Record<string, unknown>) => d.id as number);
      await odoo.write('documents.document', oldIds, { active: false });
    }

    // Create all new documents
    const createdIds: number[] = [];
    for (const file of files) {
      const docId = await odoo.create('documents.document', {
        name: file.filename,
        datas: file.data_base64,
        folder_id: HR_FOLDER_ID,
        tag_ids: [[6, 0, [docType.tagId]]],
        res_model: 'hr.employee',
        res_id: targetId,
      });
      createdIds.push(docId as number);
    }

    return NextResponse.json({
      success: true,
      document_ids: createdIds,
      doc_type: docType.key,
      file_count: createdIds.length,
    });
  } catch (err: unknown) {
    console.error('POST /api/hr/documents error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload document' },
      { status: 500 }
    );
  }
}
