/**
 * GET /api/admin/devices — running app instances a manager may see/restart.
 * Session-authed (manager/admin). Managers see only devices bound to their restaurants;
 * admins see all, including unbound public KDS/browser clients (company_id NULL).
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { listDeviceClients } from '@/lib/device-restart';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const me = requireRole('manager');
    const companyIds = me.role === 'admin' ? null : parseCompanyIds(me.allowed_company_ids);
    return NextResponse.json({ devices: listDeviceClients(companyIds) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/admin/devices error:', err);
    return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 });
  }
}
