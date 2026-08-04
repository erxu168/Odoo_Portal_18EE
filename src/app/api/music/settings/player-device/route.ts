export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { getMusicSettings, setPlayerDevice, stationDeviceExists, stationDeviceOptions } from '@/lib/music/db';

// GET — current pin + the tablets a manager can choose from.
export async function GET() {
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  return NextResponse.json({ ok: true, current: getMusicSettings().playerDeviceId, devices: stationDeviceOptions() });
}

// PUT — pin ONE physical tablet as the WAJ Radio player (null unpins).
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const raw = body?.deviceId;
  if (raw !== null && !Number.isInteger(raw)) return jsonError(400, 'Pick a tablet from the list.');
  if (raw !== null && !stationDeviceExists(raw)) return jsonError(400, 'That tablet is no longer available.');
  setPlayerDevice(raw, authz.actor.name);
  return NextResponse.json({ ok: true, current: getMusicSettings().playerDeviceId });
}
