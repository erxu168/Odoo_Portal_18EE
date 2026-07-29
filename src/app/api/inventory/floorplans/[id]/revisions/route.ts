export const dynamic = 'force-dynamic';
/**
 * /api/inventory/floorplans/[id]/revisions
 * POST — upload a processed plan as a DRAFT revision (manage).
 *
 * The browser did the heavy lifting (pdf.js raster + label extraction); this
 * route trusts NOTHING about that work: magic bytes, size and pixel caps,
 * coordinate ranges and enum values are all re-validated before anything is
 * written. Files get server-generated, content-addressed names.
 */
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { authorizeFloorplan, FLOORPLAN_CAP, canAccessCompany } from '@/lib/inventory-floorplan/access';
import {
  initFloorplanTables, ensureFloorplanUploadDir, getFloor,
  createFloorDocument, findDocumentBySha, createRevision, insertCandidates,
} from '@/lib/inventory-floorplan/db';
import { validStoredPolygon } from '@/lib/inventory-floorplan/geometry';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_RASTER_BYTES = 15 * 1024 * 1024;
const MAX_RASTER_PIXELS = 12_600_000;
const MAX_CANDIDATES = 1200;

function sha256(buf: Buffer): string { return createHash('sha256').update(buf).digest('hex'); }

function rasterMimeFromMagic(buf: Buffer): 'image/webp' | 'image/png' | null {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  return null;
}

const KIND_SET = new Set(['spot', 'room', 'other']);

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorizeFloorplan(FLOORPLAN_CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  initFloorplanTables();

  const floorId = parseInt(params.id, 10);
  const floor = Number.isFinite(floorId) && floorId > 0 ? getFloor(floorId) : null;
  if (!floor || !floor.active || !canAccessCompany(authz.user, floor.company_id)) {
    return NextResponse.json({ error: 'Floor not found' }, { status: 404 });
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }); }

  const pdfFile = form.get('pdf');
  const rasterFile = form.get('raster');
  if (!(pdfFile instanceof File) || !(rasterFile instanceof File)) {
    return NextResponse.json({ error: 'The plan PDF and its rendered image are both required' }, { status: 400 });
  }
  if (pdfFile.size <= 0 || pdfFile.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'The PDF must be smaller than 20 MB' }, { status: 400 });
  }
  if (rasterFile.size <= 0 || rasterFile.size > MAX_RASTER_BYTES) {
    return NextResponse.json({ error: 'The rendered image must be smaller than 15 MB' }, { status: 400 });
  }

  const pdfBuf = Buffer.from(await pdfFile.arrayBuffer());
  if (pdfBuf.toString('ascii', 0, 5) !== '%PDF-') {
    return NextResponse.json({ error: 'That file is not a PDF' }, { status: 400 });
  }
  const rasterBuf = Buffer.from(await rasterFile.arrayBuffer());
  const rasterMime = rasterMimeFromMagic(rasterBuf);
  if (!rasterMime) return NextResponse.json({ error: 'The rendered image must be WebP or PNG' }, { status: 400 });

  let meta: Record<string, unknown>;
  let candidates: Array<Record<string, unknown>>;
  try {
    meta = JSON.parse(String(form.get('meta') ?? '')) as Record<string, unknown>;
    candidates = JSON.parse(String(form.get('candidates') ?? '[]')) as Array<Record<string, unknown>>;
  } catch { return NextResponse.json({ error: 'Invalid upload metadata' }, { status: 400 }); }

  const pageWidth = Number(meta.pageWidth), pageHeight = Number(meta.pageHeight);
  const rasterWidth = Number(meta.rasterWidth), rasterHeight = Number(meta.rasterHeight);
  const pageNumber = Number(meta.pageNumber) || 1;
  const pageCount = Number(meta.pageCount) || 1;
  const rotation = Number(meta.rotation) || 0;
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(rasterWidth > 0) || !(rasterHeight > 0)) {
    return NextResponse.json({ error: 'Invalid page dimensions' }, { status: 400 });
  }
  if (rasterWidth * rasterHeight > MAX_RASTER_PIXELS) {
    return NextResponse.json({ error: 'The rendered image is too large' }, { status: 400 });
  }
  if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
    return NextResponse.json({ error: 'Too many detected labels' }, { status: 400 });
  }
  const drafts = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const rawText = String(c.rawText ?? '').slice(0, 200);
    const normalizedText = String(c.normalizedText ?? '').slice(0, 200);
    const kind = String(c.proposedKind ?? 'other');
    if (!rawText.trim() || !KIND_SET.has(kind) || !validStoredPolygon(c.polygon)) {
      return NextResponse.json({ error: `Detected label ${i + 1} is invalid` }, { status: 400 });
    }
    drafts.push({
      item_index: i,
      raw_text: rawText,
      normalized_text: normalizedText || rawText,
      polygon: c.polygon,
      rotation_degrees: Number.isFinite(Number(c.rotationDegrees)) ? Number(c.rotationDegrees) : 0,
      proposed_kind: kind as 'spot' | 'room' | 'other',
      proposed_type: c.proposedType != null ? String(c.proposedType).slice(0, 40) : null,
      proposed_room: c.proposedRoom != null ? String(c.proposedRoom).slice(0, 120) : null,
    });
  }

  // ---- write files (content-addressed, server-generated names) --------------
  const dir = ensureFloorplanUploadDir();
  const pdfSha = sha256(pdfBuf);
  const rasterSha = sha256(rasterBuf);
  const pdfName = `doc_${pdfSha.slice(0, 16)}.pdf`;
  const rasterName = `rev_${rasterSha.slice(0, 16)}.${rasterMime === 'image/webp' ? 'webp' : 'png'}`;
  if (!fs.existsSync(path.join(dir, pdfName))) fs.writeFileSync(path.join(dir, pdfName), pdfBuf);
  if (!fs.existsSync(path.join(dir, rasterName))) fs.writeFileSync(path.join(dir, rasterName), rasterBuf);

  const existingDoc = findDocumentBySha(floor.company_id, pdfSha);
  const documentId = existingDoc
    ? existingDoc.id
    : createFloorDocument({
        company_id: floor.company_id,
        original_filename: pdfFile.name.slice(0, 200) || 'plan.pdf',
        pdf_relpath: `floorplans/${pdfName}`,
        sha256: pdfSha,
        byte_size: pdfBuf.length,
        page_count: pageCount,
        uploaded_by: authz.actor.userId,
      });

  const revisionId = createRevision({
    floor_id: floor.id,
    document_id: documentId,
    source_page_number: pageNumber,
    page_width: pageWidth,
    page_height: pageHeight,
    page_rotation: rotation,
    raster_relpath: `floorplans/${rasterName}`,
    raster_mime: rasterMime,
    raster_width: rasterWidth,
    raster_height: rasterHeight,
    raster_bytes: rasterBuf.length,
    uploaded_by: authz.actor.userId,
  });
  insertCandidates(revisionId, drafts);

  return NextResponse.json(
    {
      revisionId,
      floorId: floor.id,
      candidateCount: drafts.length,
      duplicateDocument: existingDoc ? { uploadedAt: existingDoc.uploaded_at, filename: existingDoc.original_filename } : null,
    },
    { status: 201 },
  );
}
