import { NextResponse } from 'next/server';
import { getInviteByTokenHash } from '@/lib/db';
import { hashInviteToken } from '@/lib/hr/invites';

/**
 * GET /api/invite/[token]
 * Public. Validates an invite token and returns just enough to render the
 * set-up screen. Never leaks whether a token ever existed — any bad/used/
 * expired token returns { valid: false }.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const invite = getInviteByTokenHash(hashInviteToken(params.token || ''));

  if (!invite || invite.status !== 'pending' || new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({
    valid: true,
    name: invite.name,
    email: invite.email || '',
    needs_email: !invite.email,
    expires_at: invite.expires_at,
  });
}
