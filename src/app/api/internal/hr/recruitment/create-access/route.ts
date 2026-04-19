import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createApplicantPortalAccess } from '@/lib/hr/recruitment';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

/**
 * POST /api/internal/hr/recruitment/create-access
 * Bearer-token-authenticated. Called by the Odoo `krawings_recruitment` addon
 * when a manager clicks "Grant Portal Access" on an hr.applicant.
 *
 * Headers:
 *   Authorization: Bearer <KRAWINGS_INTERNAL_API_TOKEN>
 *   X-Odoo-User-Id: <uid>  (optional, attributes the audit entry to an Odoo user)
 *
 * Body: { applicant_id: number }
 */

const RATE_LIMIT_PER_MIN = 20;
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
  const rl = checkRateLimit(`internal:create-access:${ip}`, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    console.warn(`[internal/create-access] rate limited ip=${ip}`);
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  if (!verifyBearerToken(req)) {
    console.warn(`[internal/create-access] unauthorized ip=${ip}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let applicantId: number;
  try {
    const body = await req.json();
    applicantId = Number(body.applicant_id);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const odooUserHeader = req.headers.get('x-odoo-user-id');
  const actor = {
    id: 0,
    name: odooUserHeader ? `odoo:${odooUserHeader}` : 'odoo:unknown',
  };

  try {
    const result = await createApplicantPortalAccess(applicantId, actor);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/internal/hr/recruitment/create-access error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create portal access' },
      { status: 500 },
    );
  }
}
