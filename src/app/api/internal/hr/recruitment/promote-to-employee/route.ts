import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { promoteApplicantToEmployee } from '@/lib/hr/recruitment';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

/**
 * POST /api/internal/hr/recruitment/promote-to-employee
 * Bearer-token-authenticated. Called by the Odoo `krawings_recruitment` addon
 * when a candidate is hired — moves them from the candidate-only UX to the
 * full employee UX by stamping employee_id onto their portal user row.
 *
 * Headers:
 *   Authorization: Bearer <KRAWINGS_INTERNAL_API_TOKEN>
 *   X-Odoo-User-Id: <uid>  (optional)
 *
 * Body: { applicant_id: number, employee_id: number }
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
  const rl = checkRateLimit(`internal:promote:${ip}`, RATE_LIMIT_PER_MIN, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    console.warn(`[internal/promote-to-employee] rate limited ip=${ip}`);
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  if (!verifyBearerToken(req)) {
    console.warn(`[internal/promote-to-employee] unauthorized ip=${ip}`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let applicantId: number;
  let employeeId: number;
  try {
    const body = await req.json();
    applicantId = Number(body.applicant_id);
    employeeId = Number(body.employee_id);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const odooUserHeader = req.headers.get('x-odoo-user-id');
  const actor = {
    id: 0,
    name: odooUserHeader ? `odoo:${odooUserHeader}` : 'odoo:unknown',
  };

  try {
    const result = promoteApplicantToEmployee(applicantId, employeeId, actor);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error('POST /api/internal/hr/recruitment/promote-to-employee error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to promote applicant' },
      { status: 500 },
    );
  }
}
