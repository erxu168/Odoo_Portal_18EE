/**
 * POST /api/station/sign-out
 * Ends the current acting person on a shared kitchen tablet by DELETING the
 * server-stored acting token (the security-relevant step). Called by StationGate
 * on Done / idle timeout / company switch. Station-account (is_shared_device) only.
 *
 * It deliberately does NOT clear the httpOnly cookie: a deleted token is already
 * inert (resolveAttribution falls back to the station account), and the next PIN
 * login overwrites the cookie — clearing it here would race with, and wipe, a
 * newly minted cookie if the next person signs in immediately.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/auth';
import { deleteStationActor } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  const device = getCurrentUser();
  if (!device || !device.is_shared_device) {
    return NextResponse.json({ error: 'Not a station tablet.' }, { status: 403 });
  }
  try {
    const token = cookies().get('kw_actor')?.value;
    if (token) deleteStationActor(token);
  } catch { /* best effort — token is also session-bound + expires */ }
  return NextResponse.json({ ok: true });
}
