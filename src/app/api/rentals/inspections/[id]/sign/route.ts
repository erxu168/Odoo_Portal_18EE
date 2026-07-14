// src/app/api/rentals/inspections/[id]/sign/route.ts
// Finalize inspection: capture landlord signature, generate PDF, archive
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { renderInspectionPdf } from '@/lib/inspection-pdf';
import { htmlToPdf, pdfOutputPath } from '@/lib/pdf-generator';
import { Inspection } from '@/types/rentals';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const inspectionId = Number(params.id);
    const body = await req.json();
    const { landlord_signature_path, tenant_signature_path } = body;

    const inspection = db.prepare(`SELECT * FROM inspections WHERE id = ?`).get(inspectionId) as Inspection | undefined;
    if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const now = berlinNow();

    // Update signatures
    if (tenant_signature_path) {
      db.prepare(`UPDATE inspections SET tenant_signature_path = ?, tenant_signed_at = ? WHERE id = ?`)
        .run(tenant_signature_path, now, inspectionId);
    }
    if (landlord_signature_path) {
      db.prepare(`UPDATE inspections SET landlord_signature_path = ?, landlord_signed_at = ? WHERE id = ?`)
        .run(landlord_signature_path, now, inspectionId);
    }

    // Generate PDF
    const html = await renderInspectionPdf(inspectionId);
    const outPath = pdfOutputPath('uebergabe', inspectionId);
    await htmlToPdf(html, outPath);

    db.prepare(`
      UPDATE inspections SET pdf_path = ?, status = 'signed', updated_at = ? WHERE id = ?
    `).run(outPath, now, inspectionId);

    return NextResponse.json({ pdf_path: outPath, status: 'signed' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
