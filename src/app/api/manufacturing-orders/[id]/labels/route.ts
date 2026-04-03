/**
 * POST /api/manufacturing-orders/[id]/labels
 * Generate ZPL + send to Zebra printer for one or all containers.
 *
 * Body: {
 *   printer_id: number;
 *   container_ids?: number[];  // omit = print all
 *   label_size_id?: string;    // override printer default
 *   custom_width_mm?: number;
 *   custom_height_mm?: number;
 * }
 *
 * GET /api/manufacturing-orders/[id]/labels?container_id=X&label_size_id=Y
 * Preview: returns ZPL string without printing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import {
  getSplitByMo, getContainers, getPrinter, createPrintJob,
  updatePrintJobStatus, markContainerPrinted, markSplitPrinted,
} from '@/lib/labeling-db';
import { generateZPL, resolveLabelSize, sendToZebra } from '@/lib/zpl';
import type { LabelData } from '@/types/labeling';

interface RouteParams { params: Promise<{ id: string }> }

function formatDateDE(isoOrDate: string | null): string {
  if (!isoOrDate) return '-';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return isoOrDate;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// --- GET: preview ZPL ---
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const moId = parseInt(id, 10);
  if (isNaN(moId)) return NextResponse.json({ error: 'Invalid MO ID' }, { status: 400 });

  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const split = getSplitByMo(moId);
  if (!split) return NextResponse.json({ error: 'No container split found for this MO' }, { status: 404 });

  const containers = getContainers(split.id);
  const { searchParams } = new URL(req.url);
  const containerIdParam = searchParams.get('container_id');
  const labelSizeId = searchParams.get('label_size_id') ?? '55x75';
  const customW = searchParams.get('custom_width_mm');
  const customH = searchParams.get('custom_height_mm');

  const { widthMm, heightMm } = resolveLabelSize(
    labelSizeId,
    customW ? parseFloat(customW) : null,
    customH ? parseFloat(customH) : null,
  );

  const target = containerIdParam
    ? containers.filter(c => c.id === parseInt(containerIdParam, 10))
    : containers;

  const previews = target.map(c => {
    const labelData: LabelData = {
      productName: split.product_name,
      productionDate: formatDateDE(split.confirmed_at ?? split.created_at),
      qty: c.qty,
      uom: split.uom,
      expiryDate: formatDateDE(c.expiry_date),
      lotName: c.lot_name ?? undefined,
      moName: split.mo_name,
      containerNumber: c.sequence,
      totalContainers: containers.length,
      barcodeValue: c.lot_name ?? split.mo_name,
    };
    return {
      container_id: c.id,
      sequence: c.sequence,
      zpl: generateZPL(labelData, { widthMm, heightMm }),
    };
  });

  return NextResponse.json({ previews, widthMm, heightMm, labelSizeId });
}

// --- POST: print labels ---
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const moId = parseInt(id, 10);
  if (isNaN(moId)) return NextResponse.json({ error: 'Invalid MO ID' }, { status: 400 });

  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { printer_id, container_ids, label_size_id, custom_width_mm, custom_height_mm } = body;

  // Validate printer
  const printer = getPrinter(printer_id);
  if (!printer) return NextResponse.json({ error: 'Printer not found' }, { status: 404 });

  // Resolve label size (body override > printer default)
  const sizeId = label_size_id ?? printer.default_label_size_id;
  const custW = custom_width_mm ?? printer.custom_width_mm;
  const custH = custom_height_mm ?? printer.custom_height_mm;
  const { widthMm, heightMm } = resolveLabelSize(sizeId, custW, custH);

  // Get split + containers
  const split = getSplitByMo(moId);
  if (!split) return NextResponse.json({ error: 'No container split found' }, { status: 404 });
  if (split.status === 'draft') {
    return NextResponse.json({ error: 'Split not yet confirmed. Run package flow first.' }, { status: 400 });
  }

  const allContainers = getContainers(split.id);
  const targets = container_ids
    ? allContainers.filter(c => (container_ids as number[]).includes(c.id))
    : allContainers;

  if (targets.length === 0) {
    return NextResponse.json({ error: 'No containers to print' }, { status: 400 });
  }

  const results: { container_id: number; jobId: number; success: boolean; error?: string }[] = [];

  for (const c of targets) {
    const labelData: LabelData = {
      productName: split.product_name,
      productionDate: formatDateDE(split.confirmed_at ?? split.created_at),
      qty: c.qty,
      uom: split.uom,
      expiryDate: formatDateDE(c.expiry_date),
      lotName: c.lot_name ?? undefined,
      moName: split.mo_name,
      containerNumber: c.sequence,
      totalContainers: allContainers.length,
      barcodeValue: c.lot_name ?? split.mo_name,
    };

    const zpl = generateZPL(labelData, { widthMm, heightMm, dpi: printer.dpi });

    // Create print job record
    const jobId = createPrintJob({
      container_id: c.id,
      printer_id: printer.id,
      printer_name: printer.name,
      label_size_id: sizeId,
      label_width_mm: widthMm,
      label_height_mm: heightMm,
      zpl_content: zpl,
      printed_by: user.id,
      printed_by_name: user.name,
    });

    // Send to printer
    try {
      await sendToZebra(printer.ip_address, printer.port, zpl);
      updatePrintJobStatus(jobId, 'success');
      markContainerPrinted(c.id);
      results.push({ container_id: c.id, jobId, success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      updatePrintJobStatus(jobId, 'error', msg);
      results.push({ container_id: c.id, jobId, success: false, error: msg });
    }
  }

  // If all printed, mark split as printed
  const allPrinted = results.every(r => r.success);
  if (allPrinted) markSplitPrinted(split.id);

  return NextResponse.json({ results, allPrinted });
}
