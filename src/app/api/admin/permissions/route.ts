import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import {
  PERMISSION_ACTIONS, PERMISSIONS_MANAGE_KEY, actionByKey, isValidRoleArray,
} from '@/lib/permissions';
import {
  getPermissionOverrides, setPermissionOverride, clearPermissionOverrides,
} from '@/lib/db';

function requireAdmin() {
  const me = getCurrentUser();
  if (!me || !hasRole(me, 'admin')) return null;
  return me;
}

/** GET /api/admin/permissions — the full registry + current overrides. Admin only. */
export async function GET() {
  if (!requireAdmin()) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  return NextResponse.json({
    actions: PERMISSION_ACTIONS,
    overrides: getPermissionOverrides(),
  });
}

/** POST /api/admin/permissions — set one action's roles, or reset. Admin only. */
export async function POST(request: Request) {
  if (!requireAdmin()) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();

    // Reset paths
    if (body.reset === 'all') {
      clearPermissionOverrides(PERMISSION_ACTIONS.map((a) => a.key));
      return NextResponse.json({ overrides: getPermissionOverrides() });
    }
    if (body.reset === 'module') {
      const keys = PERMISSION_ACTIONS.filter((a) => a.module === body.module).map((a) => a.key);
      clearPermissionOverrides(keys);
      return NextResponse.json({ overrides: getPermissionOverrides() });
    }

    // Set-one path
    const { action_key, allowed_roles } = body;
    if (typeof action_key !== 'string' || !actionByKey(action_key)) {
      return NextResponse.json({ error: 'Unknown action_key' }, { status: 400 });
    }
    if (action_key === PERMISSIONS_MANAGE_KEY) {
      return NextResponse.json({ error: 'This permission is locked to admin' }, { status: 400 });
    }
    if (!isValidRoleArray(allowed_roles)) {
      return NextResponse.json({ error: 'allowed_roles must be a subset of staff/manager/admin' }, { status: 400 });
    }
    // Admin can never be removed — always retains access (fail-safe).
    const roles = Array.from(new Set([...allowed_roles, 'admin']));
    setPermissionOverride(action_key, roles);
    return NextResponse.json({ overrides: getPermissionOverrides() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update permissions';
    console.error('POST /api/admin/permissions error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
