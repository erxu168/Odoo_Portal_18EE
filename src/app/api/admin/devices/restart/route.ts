/**
 * POST /api/admin/devices/restart — a manager triggers a remote restart.
 * Body: { target: { type:'client', clientId } | { type:'surface', surface } | { type:'all' }, reason? }
 *
 * Session-authed (manager/admin) + same-origin. Managers may only target devices bound
 * to their restaurants; admins are unrestricted. A single-device restart fires ~now; a
 * group restart is staggered so the fleet doesn't reconnect all at once.
 */
import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { parseCompanyIds, logAudit } from '@/lib/db';
import { isSameOrigin } from '@/lib/csrf';
import {
  issueRestartCommand,
  getDeviceClientCompany,
  type RestartScope,
} from '@/lib/device-restart';

export const dynamic = 'force-dynamic';

const GROUP_SPREAD_MS = 30_000;

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });
    }
    const me = requireRole('manager');
    const companyIds = me.role === 'admin' ? null : parseCompanyIds(me.allowed_company_ids);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const target = (body.target ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;

    let scope: RestartScope;
    let spreadMs = 0;
    if (target.type === 'client' && typeof target.clientId === 'string') {
      // A manager can only restart a device inside their own company scope.
      const company = getDeviceClientCompany(target.clientId);
      if (company === undefined) return NextResponse.json({ error: 'Device not found' }, { status: 404 });
      if (companyIds !== null && (company == null || !companyIds.includes(company))) {
        return NextResponse.json({ error: 'You can’t restart this device.' }, { status: 403 });
      }
      scope = { type: 'client', clientId: target.clientId };
    } else if (target.type === 'surface' && typeof target.surface === 'string') {
      scope = { type: 'surface', surface: target.surface.slice(0, 32) };
      spreadMs = GROUP_SPREAD_MS;
    } else if (target.type === 'all') {
      scope = { type: 'all' };
      spreadMs = GROUP_SPREAD_MS;
    } else {
      return NextResponse.json({ error: 'Bad target' }, { status: 400 });
    }

    const result = issueRestartCommand({
      scope,
      source: me.role === 'admin' ? 'admin' : 'manager',
      createdBy: me.name,
      reason,
      spreadMs,
      companyIds,
    });

    logAudit({
      user_id: me.id,
      user_name: me.name,
      action: 'device_restart',
      module: 'device',
      detail: `scope=${JSON.stringify(scope)} recipients=${result.recipients} command=${result.commandId}`,
    });

    return NextResponse.json({ ok: true, commandId: result.commandId, recipients: result.recipients });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('POST /api/admin/devices/restart error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
