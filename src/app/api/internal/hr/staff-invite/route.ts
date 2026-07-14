import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createStaffInvite } from '@/lib/hr/invites';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

/**
 * POST /api/internal/hr/staff-invite
 * Bearer-token-authenticated. Called by the Odoo `krawings_portal_invite`
 * addon when a new hr.employee is created, to auto-create + email an invite.
 *
 * Headers:
 *   Authorization: Bearer <KRAWINGS_INTERNAL_API_TOKEN>
 *   X-Odoo-User-Id: <uid>  (optional)
 * Body: { employee_id: number }
 */

const RATE_LIMIT_PER_MIN = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function verifyBearerToken(req: NextRequest): boolean {
  const expected = process.env.KRAWINGS_INTERNAL_API_TOKEN;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  if (!match) return false;
  const provided = match[1].trim();
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(`internal:staff-invite:${ip}`, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    console.warn(`[internal/staff-invite] rate limited ip=${ip}`);
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  if (!verifyBearerToken(req)) {
    console.warn(`[internal/staff-invite] unauthorized ip=${ip}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let employeeId: number;
  try {
    const body = await req.json();
    employeeId = Number(body.employee_id);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const odooUserHeader = req.headers.get('x-odoo-user-id');
  const actor = { id: 0, name: odooUserHeader ? `odoo:${odooUserHeader}` : 'odoo:auto' };

  try {
    const result = await createStaffInvite(employeeId, actor, { sendEmail: true });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/internal/hr/staff-invite error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create staff invite' },
      { status: 500 },
    );
  }
}
