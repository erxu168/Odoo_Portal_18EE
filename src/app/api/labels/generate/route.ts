/**
 * POST /api/labels/generate
 *
 * Generate ZPL for one ad-hoc label (no MO, no Odoo lot creation).
 * Used by the "Label Print" flow on the manufacturing dashboard so staff
 * can print labels for any recipe without producing it first.
 *
 * Body: {
 *   productName: string;
 *   qty: number;
 *   uom: string;
 *   productionDate: string;       // YYYY-MM-DD or DE display string
 *   expiryDate: string;           // YYYY-MM-DD or DE display string
 *   lotName?: string;
 *   containerNumber?: number;     // default 1
 *   totalContainers?: number;     // default 1
 *   barcodeValue?: string;        // default lotName ?? productName
 *   labelSizeId?: string;
 *   widthMm?: number;
 *   heightMm?: number;
 * }
 *
 * Returns: { zpl: string, widthMm: number, heightMm: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/db';
import { cookies } from 'next/headers';
import { generateZPL, resolveLabelSize } from '@/lib/zpl';
import type { LabelData } from '@/types/labeling';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('kw_session')?.value;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    productName, productReference, qty, uom, productionDate, expiryDate, lotName,
    containerNumber, totalContainers, barcodeValue,
    labelSizeId, widthMm: bodyWidth, heightMm: bodyHeight,
  } = body;

  if (!productName || typeof qty !== 'number' || !uom || !productionDate || !expiryDate) {
    return NextResponse.json(
      { error: 'productName, qty, uom, productionDate, expiryDate are required' },
      { status: 400 },
    );
  }

  const { widthMm, heightMm } = resolveLabelSize(
    labelSizeId ?? '55x75',
    bodyWidth ?? null,
    bodyHeight ?? null,
  );

  const labelData: LabelData = {
    productName,
    productReference: productReference || undefined,
    productionDate,
    qty,
    uom,
    expiryDate,
    lotName: lotName || undefined,
    moName: lotName || productName,
    containerNumber: containerNumber ?? 1,
    totalContainers: totalContainers ?? 1,
    barcodeValue: barcodeValue ?? lotName ?? productName,
  };

  const zpl = generateZPL(labelData, { widthMm, heightMm });
  return NextResponse.json({ zpl, widthMm, heightMm });
}
