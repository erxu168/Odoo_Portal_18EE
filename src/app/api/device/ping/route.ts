/**
 * POST /api/device/ping — device heartbeat for the remote-restart feature.
 *
 * Public path (KDS/kiosk run unauthenticated), so identity is: a client-generated id
 * + a secret we issue on first contact and verify thereafter. Company/user are derived
 * SERVER-SIDE from the session when one is present — never trusted from the body. The
 * response carries at most one pending restart command for this device.
 *
 * Body: { clientId, secret?, shell?, surface?, nativeRelaunch?, appVersion?, lastExecutedCommandId? }
 * Reply: { ok, issuedSecret?, restart: { commandId, delayMs } | null }
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isSameOrigin } from '@/lib/csrf';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { getCurrentUser, COOKIE_NAME } from '@/lib/auth';
import { getStationDeviceForSession, parseCompanyIds } from '@/lib/db';
import { heartbeat, type HeartbeatInput } from '@/lib/device-restart';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: 'Request blocked.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
    if (!clientId) {
      return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    }

    // Rate-limit per client id (falls back to IP) — heartbeats poll ~every 10s, so
    // a generous window still catches a runaway/abusive caller.
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`device-ping:${clientId || ip}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // Trusted, server-derived identity from the session (if any).
    let sessionCompanyId: number | null = null;
    let sessionUserId: number | null = null;
    let stationDeviceId: number | null = null;
    const user = getCurrentUser();
    if (user) {
      sessionUserId = user.id;
      const token = cookies().get(COOKIE_NAME)?.value;
      const device = token ? getStationDeviceForSession(token) : null;
      if (device) {
        // Provisioned shared tablet → strong, single-company binding.
        sessionCompanyId = device.company_id;
        stationDeviceId = device.id;
      } else {
        // Regular login: bind to the company only when it's unambiguous.
        const companies = parseCompanyIds(user.allowed_company_ids);
        if (companies.length === 1) sessionCompanyId = companies[0];
      }
    }

    const input: HeartbeatInput = {
      clientId,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
      shell: typeof body.shell === 'string' ? body.shell : null,
      surface: typeof body.surface === 'string' ? body.surface : null,
      nativeRelaunch: body.nativeRelaunch === true,
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : null,
      lastExecutedCommandId:
        typeof body.lastExecutedCommandId === 'number' ? body.lastExecutedCommandId : 0,
      sessionCompanyId,
      sessionUserId,
      stationDeviceId,
    };

    const result = heartbeat(input);
    if (!result.ok) {
      // A mismatched secret means someone else is using this client id — 403.
      const status = result.error === 'bad_credential' ? 403 : 400;
      return NextResponse.json({ error: result.error || 'Bad request' }, { status });
    }

    return NextResponse.json({
      ok: true,
      ...(result.issuedSecret ? { issuedSecret: result.issuedSecret } : {}),
      restart: result.restart,
    });
  } catch (err) {
    console.error('POST /api/device/ping error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
