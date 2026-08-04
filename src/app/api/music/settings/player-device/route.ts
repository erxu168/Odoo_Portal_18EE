export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { companyScope } from '@/lib/inventory-access';
import { logAudit } from '@/lib/db';
import { getMusicSettings, setPlayerDevice, stationDeviceExists, stationDeviceOptions } from '@/lib/music/db';

// GET — current pin + the tablets THIS manager may choose from (company-scoped).
export async function GET() {
  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  const scope = companyScope(authz.user);
  return NextResponse.json({ ok: true, current: getMusicSettings().playerDeviceId, devices: stationDeviceOptions(scope) });
}

// PUT — pin ONE physical tablet as the WAJ Radio player (null unpins).
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const raw = body?.deviceId;
  const scope = companyScope(authz.user);
  if (raw !== null && !Number.isInteger(raw)) return jsonError(400, 'Pick a tablet from the list.');
  if (raw !== null && !stationDeviceExists(raw, scope)) return jsonError(400, 'That tablet is not available to you.');
  const before = getMusicSettings().playerDeviceId;
  setPlayerDevice(raw, authz.actor.name);
  logAudit({
    user_id: authz.actor.userId, user_name: authz.actor.name,
    action: raw == null ? 'music.device.unpin' : 'music.device.pin', module: 'music',
    target_type: 'station_device', target_id: raw ?? before ?? undefined,
    detail: `player device ${before ?? 'none'} → ${raw ?? 'none'}`,
  });
  return NextResponse.json({ ok: true, current: getMusicSettings().playerDeviceId });
}
