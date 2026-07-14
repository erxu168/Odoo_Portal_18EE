/**
 * GET  /api/printers          - list active printers
 * POST /api/printers          - create new printer (admin only)
 * PUT  /api/printers?id=X     - update printer (admin only)
 * DELETE /api/printers?id=X   - soft-delete printer (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import { listPrinters, createPrinter, updatePrinter, deletePrinter, getPrinter } from '@/lib/labeling-db';
import { LABEL_SIZE_PRESETS, LABEL_CONSTRAINTS } from '@/types/labeling';
import type { CreatePrinterRequest } from '@/types/labeling';

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return null;
  return getSessionUser(token);
}

// --- GET ---
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const printers = listPrinters(true);
  return NextResponse.json({
    printers,
    label_presets: LABEL_SIZE_PRESETS,
    constraints: LABEL_CONSTRAINTS,
  });
}

// --- POST ---
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json() as CreatePrinterRequest;
  if (!body.name || !body.ip_address || !body.location_id) {
    return NextResponse.json({ error: 'name, ip_address, and location_id are required' }, { status: 400 });
  }

  // Validate custom size
  if (body.default_label_size_id === 'custom') {
    if (!body.custom_width_mm || !body.custom_height_mm) {
      return NextResponse.json({ error: 'Custom size requires width and height in mm' }, { status: 400 });
    }
    if (body.custom_width_mm > LABEL_CONSTRAINTS.maxWidthMm) {
      return NextResponse.json({ error: `Width cannot exceed ${LABEL_CONSTRAINTS.maxWidthMm}mm` }, { status: 400 });
    }
    if (body.custom_height_mm < LABEL_CONSTRAINTS.minHeightMm) {
      return NextResponse.json({ error: `Height must be at least ${LABEL_CONSTRAINTS.minHeightMm}mm` }, { status: 400 });
    }
  }

  // Validate IP format
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(body.ip_address)) {
    return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 });
  }

  const id = createPrinter(body);
  const printer = getPrinter(id);
  return NextResponse.json({ printer }, { status: 201 });
}

// --- PUT ---
export async function PUT(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') ?? '', 10);
  if (isNaN(id)) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const existing = getPrinter(id);
  if (!existing) return NextResponse.json({ error: 'Printer not found' }, { status: 404 });

  const body = await req.json();
  updatePrinter(id, body);
  const updated = getPrinter(id);
  return NextResponse.json({ printer: updated });
}

// --- DELETE ---
export async function DELETE(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') ?? '', 10);
  if (isNaN(id)) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  deletePrinter(id);
  return NextResponse.json({ success: true });
}
