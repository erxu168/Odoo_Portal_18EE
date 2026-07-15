/**
 * GET /api/tablet/status — is THIS device a provisioned shared tablet?
 * Reads the httpOnly kw_tablet cookie. Used by the login page to decide whether
 * to show the PIN pad (provisioned) or the normal email/password form. No Odoo,
 * no session — fast + safe to call before login.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStationDevice } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET() {
  const token = cookies().get('kw_tablet')?.value;
  const device = token ? getStationDevice(token) : null;
  if (!device) return NextResponse.json({ provisioned: false });
  return NextResponse.json({
    provisioned: true,
    company_id: device.company_id,
    company_name: device.label || '', // stored at provision time
  });
}
