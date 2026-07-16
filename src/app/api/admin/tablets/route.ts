/**
 * GET /api/admin/tablets — provisioned shared tablets a manager may manage.
 * Session-authed (manager/admin). Managers see only tablets for their restaurants;
 * admins see all. The restaurant name is the label stored at provision time.
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { listStationDevices, parseCompanyIds } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const me = requireRole('manager');
    const companyIds = me.role === 'admin' ? null : parseCompanyIds(me.allowed_company_ids);
    return NextResponse.json({ tablets: listStationDevices(companyIds) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('GET /api/admin/tablets error:', err);
    return NextResponse.json({ error: 'Failed to load tablets' }, { status: 500 });
  }
}
