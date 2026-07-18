/**
 * POST /api/internal/device-restart — the deploy hook's remote-restart trigger.
 *
 * Called by ops/portal-lib.sh from 127.0.0.1 after a healthy deploy. NOT a browser
 * endpoint (no cookie / same-origin): authenticated by a dedicated high-entropy Bearer
 * secret, DEVICE_RESTART_TOKEN. Fails closed if the secret is unset.
 *
 * The audience is HARDCODED to the auto-restart fleet (unattended displays that opted
 * in) — the caller cannot target arbitrary devices or personal phones. Idempotent on
 * the deploy SHA, so a retry for the same commit returns the same command.
 *
 * Headers: Authorization: Bearer <DEVICE_RESTART_TOKEN>
 * Body: { deploySha: string (required — the idempotency key), env?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { logAudit } from '@/lib/db';
import { issueRestartCommand } from '@/lib/device-restart';

export const dynamic = 'force-dynamic';

const GROUP_SPREAD_MS = 30_000;

function verifyBearerToken(req: NextRequest): boolean {
  const expected = process.env.DEVICE_RESTART_TOKEN;
  if (!expected) return false; // fail closed — no secret configured
  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(match[1].trim());
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(`internal:device-restart:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  if (!verifyBearerToken(req)) {
    console.warn(`[internal/device-restart] unauthorized ip=${ip}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deploySha = typeof body.deploySha === 'string' ? body.deploySha.trim().slice(0, 64) : '';
  const env = typeof body.env === 'string' ? body.env.slice(0, 32) : null;
  // A deploy SHA is REQUIRED — it's the idempotency key, so a hook retry re-issues
  // nothing. Our shell hook always sends `$newsha`; reject a SHA-less call rather than
  // silently spawn a fresh fleet restart on every retry.
  if (!deploySha) {
    return NextResponse.json({ error: 'deploySha required' }, { status: 400 });
  }
  const idempotencyKey = `deploy:${deploySha}`;

  const result = issueRestartCommand({
    scope: { type: 'auto' }, // hardcoded audience — auto-restart fleet only
    source: 'deploy',
    createdBy: env ? `auto-deploy (${env})` : 'auto-deploy',
    reason: `deploy ${deploySha}`,
    deploySha,
    idempotencyKey,
    spreadMs: GROUP_SPREAD_MS,
    companyIds: null,
  });

  if (!result.deduped) {
    logAudit({
      user_id: null,
      user_name: env ? `auto-deploy (${env})` : 'auto-deploy',
      action: 'device_restart_auto',
      module: 'device',
      detail: `sha=${deploySha ?? '-'} recipients=${result.recipients} command=${result.commandId}`,
    });
  }

  return NextResponse.json({
    ok: true,
    commandId: result.commandId,
    recipients: result.recipients,
    deduped: result.deduped,
  });
}
