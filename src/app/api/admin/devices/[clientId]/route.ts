/**
 * PATCH /api/admin/devices/[clientId] — rename a device or toggle its auto-restart
 * (whether it restarts automatically after a deploy). Body: { label? , auto_restart? }.
 * Session-authed (manager/admin) + same-origin, scoped to the manager's restaurants.
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds, logAudit } from '@/lib/db';
import { isSameOrigin } from '@/lib/csrf';
import { setDeviceAutoRestart, renameDeviceClient } from '@/lib/device-restart';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: { clientId: string } }) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });
    }
    const me = requireRole('manager');
    const companyIds = me.role === 'admin' ? null : parseCompanyIds(me.allowed_company_ids);
    const clientId = params.clientId;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    let touched = false;

    if (typeof body.auto_restart === 'boolean') {
      const ok = setDeviceAutoRestart(clientId, body.auto_restart, companyIds);
      if (!ok) return NextResponse.json({ error: 'You can’t manage this device.' }, { status: 403 });
      logAudit({
        user_id: me.id,
        user_name: me.name,
        action: body.auto_restart ? 'device_auto_restart_on' : 'device_auto_restart_off',
        module: 'device',
        detail: `client=${clientId}`,
      });
      touched = true;
    }

    if (typeof body.label === 'string') {
      const ok = renameDeviceClient(clientId, body.label, companyIds);
      if (!ok) return NextResponse.json({ error: 'You can’t manage this device.' }, { status: 403 });
      touched = true;
    }

    if (!touched) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('PATCH /api/admin/devices/[clientId] error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
