export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/csrf';
import { authorize, CAP } from '@/lib/music/access';
import { jsonError } from '@/lib/music/route-helpers';
import { companyScope } from '@/lib/inventory-access';
import { getDb, logAudit } from '@/lib/db';
import { getMusicSettings, setPlayerDevice, stationDeviceExists, stationDeviceOptions } from '@/lib/music/db';
import { moduleForbidden } from '@/lib/module-access';

// GET — current pin + the tablets THIS manager may choose from (company-scoped).
// An out-of-scope pin is reported as locked, not exposed.
export async function GET() {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  const authz = authorize(CAP.manage);
  if (!authz.ok) return jsonError(authz.status, authz.error);
  const scope = companyScope(authz.user);
  const current = getMusicSettings().playerDeviceId;
  const currentInScope = current == null || stationDeviceExists(current, scope);
  return NextResponse.json({
    ok: true,
    current: currentInScope ? current : null,
    lockedByOtherCompany: !currentInScope,
    devices: stationDeviceOptions(scope),
  });
}

// PUT — pin ONE physical tablet as the WAJ Radio player (null unpins). Changing
// or clearing an existing pin requires authority over the CURRENT device too.
export async function PUT(request: Request) {
  const denied = moduleForbidden('music');
  if (denied) return denied;

  if (!isSameOrigin(request)) return jsonError(403, 'Blocked request.');
  const authz = authorize(CAP.manage, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);

  const body = await request.json().catch(() => ({}));
  const raw = body?.deviceId;
  const scope = companyScope(authz.user);
  if (raw !== null && !Number.isInteger(raw)) return jsonError(400, 'Pick a tablet from the list.');
  if (raw !== null && !stationDeviceExists(raw, scope)) return jsonError(400, 'That tablet is not available to you.');
  const before = getMusicSettings().playerDeviceId;
  if (before != null && !stationDeviceExists(before, scope)) {
    return jsonError(403, "Another restaurant's tablet is pinned — only their managers can change it.");
  }
  const tx = getDb().transaction(() => {
    setPlayerDevice(raw, authz.actor.name);
    logAudit({
      user_id: authz.actor.userId, user_name: authz.actor.name,
      action: raw == null ? 'music.device.unpin' : 'music.device.pin', module: 'music',
      target_type: 'station_device', target_id: raw ?? before ?? undefined,
      detail: `player device ${before ?? 'none'} → ${raw ?? 'none'}`,
    });
  });
  tx();
  return NextResponse.json({ ok: true, current: getMusicSettings().playerDeviceId });
}
