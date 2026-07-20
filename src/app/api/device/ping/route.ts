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

/**
 * Our own Odoo POS origins, allowed to heartbeat CROSS-origin: the POS web client
 * runs on the Odoo server's origin (not the portal's), so its pings arrive
 * cross-origin and would fail the same-origin gate. Identity/auth is unchanged
 * (clientId + issued secret); this only opens the browser-origin door for these
 * known hosts. Cookies are never involved (the POS pings with credentials:omit,
 * and we do NOT send Access-Control-Allow-Credentials), so a POS ping registers
 * unbound (no company) → admin-only in the device list. STAGING origins only —
 * adding the production POS at rollout is a deliberate code change, not config.
 */
const POS_ORIGINS = new Set([
  'https://test18ee.krawings.de', // staging Odoo POS
  'http://89.167.124.0:15069', // staging Odoo direct
]);

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600', // cache the preflight — mostly 1 request per ping
    Vary: 'Origin',
  };
}

/** Preflight for the cross-origin POS heartbeat (JSON POST triggers one). */
export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '';
  const method = request.headers.get('access-control-request-method') || '';
  if (POS_ORIGINS.has(origin) && method === 'POST') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  // No ACAO on rejects, and never cacheable — a rejected preflight must not poison
  // a shared cache entry for another origin.
  return new NextResponse(null, {
    status: 403,
    headers: { 'Cache-Control': 'no-store', Vary: 'Origin, Access-Control-Request-Method' },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || '';
  const crossOrigin = POS_ORIGINS.has(origin);
  // Attach CORS headers on EVERY response for an allowlisted cross-origin caller
  // (including errors — the browser hides the body otherwise).
  const respond = (body: unknown, init?: { status?: number }) =>
    NextResponse.json(body, { ...init, ...(crossOrigin ? { headers: corsHeaders(origin) } : {}) });
  try {
    if (!crossOrigin && !isSameOrigin(request)) {
      return respond({ error: 'Request blocked.' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
    if (!clientId) {
      return respond({ error: 'clientId required' }, { status: 400 });
    }

    // Rate-limit per client id — heartbeats poll ~every 10s, so a generous window
    // still catches a runaway caller — PLUS a per-IP cap, since clientId is
    // caller-chosen and rotating it would otherwise bypass the limit entirely
    // (and grow device_clients unboundedly).
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`device-ping:${clientId || ip}`, 30, 60_000);
    const rlIp = checkRateLimit(`device-ping-ip:${ip}`, 120, 60_000);
    if (!rl.allowed || !rlIp.allowed) {
      return respond({ error: 'Too many requests' }, { status: 429 });
    }

    // Trusted, server-derived identity from the session (if any). NEVER for an
    // allowlisted cross-origin caller: browsers can attach cookies to a
    // cross-site request in ways CORS does not prevent (it only hides the
    // response), so honoring them would let POS-origin code register a
    // company/user-bound device. Cross-origin devices stay unbound, always.
    let sessionCompanyId: number | null = null;
    let sessionUserId: number | null = null;
    let stationDeviceId: number | null = null;
    const user = crossOrigin ? null : getCurrentUser();
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
      return respond({ error: result.error || 'Bad request' }, { status });
    }

    return respond({
      ok: true,
      ...(result.issuedSecret ? { issuedSecret: result.issuedSecret } : {}),
      restart: result.restart,
    });
  } catch (err) {
    console.error('POST /api/device/ping error:', err);
    return respond({ error: 'Failed' }, { status: 500 });
  }
}
