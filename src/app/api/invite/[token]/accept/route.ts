import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';
import { acceptStaffInvite } from '@/lib/hr/invites';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

/**
 * POST /api/invite/[token]/accept
 * Public. Body: { email, password }. Creates the linked staff account and
 * logs the user straight in by setting the session cookie.
 */
const RATE_LIMIT_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60_000; // 10 minutes

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = clientIpFromHeaders(req.headers);
  const rl = checkRateLimit(`invite-accept:${ip}`, RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let email = '';
  let password = '';
  try {
    const body = await req.json();
    email = String(body.email || '');
    password = String(body.password || '');
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const result = await acceptStaffInvite(params.token, email, password);

  if (!result.ok || !result.sessionToken) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const response = NextResponse.json(result.body, { status: 200 });
  response.cookies.set(COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
