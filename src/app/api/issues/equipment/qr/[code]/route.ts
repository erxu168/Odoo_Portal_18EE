/**
 * /api/issues/equipment/qr/[code]
 *
 * GET — lookup equipment by QR code payload. Used when staff scans a QR sticker.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { initIssuesTables, getEquipmentByQR } from '@/lib/issues-db';

initIssuesTables();

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const equipment = getEquipmentByQR(params.code);
  if (!equipment) {
    return NextResponse.json({ error: 'Equipment not found for this QR code' }, { status: 404 });
  }

  return NextResponse.json({ equipment });
}
