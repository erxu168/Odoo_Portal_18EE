import { NextResponse } from 'next/server';
import { getCurrentUser, hasRole } from '@/lib/auth';
import { PORTAL_MODULES, GOVERNED_MODULE_IDS, rolesForModule } from '@/lib/modules';
import { isValidRoleArray } from '@/lib/permissions';
import {
  getRoleModuleOverrides, setRoleModuleOverride, clearRoleModuleOverrides,
  countUsersWithCustomModules,
} from '@/lib/db';

/**
 * Which modules each ROLE gets — the top grid on /admin/permissions.
 *
 * Deliberately the twin of /api/admin/permissions: same override-or-default
 * model, same admin-always-kept rule. That one governs what you may DO inside a
 * module; this one governs whether you can OPEN it at all.
 *
 * Reads are manager+ because the Manage Staff / portal-access screens show
 * "role default" next to each person and would otherwise display the built-in
 * default rather than the truth. Writes are admin-only.
 */
function canRead() {
  const me = getCurrentUser();
  return me && hasRole(me, 'manager') ? me : null;
}
function canWrite() {
  const me = getCurrentUser();
  return me && hasRole(me, 'admin') ? me : null;
}

/** GET — every module, who currently gets it, and how many people opt out of the rule. */
export async function GET() {
  if (!canRead()) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  const overrides = getRoleModuleOverrides();
  return NextResponse.json({
    modules: PORTAL_MODULES.map((m) => ({
      id: m.id,
      label: m.label,
      minRole: m.minRole,
      roles: rolesForModule(m.id, overrides),
      customised: Object.prototype.hasOwnProperty.call(overrides, m.id),
    })),
    overrides,
    // Shown as a warning: these people have their own list, which beats this grid.
    usersWithCustomModules: countUsersWithCustomModules(),
  });
}

/** POST — set one module's roles, or reset one/all back to the built-in default. */
export async function POST(request: Request) {
  if (!canWrite()) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();

    if (body.reset === 'all') {
      clearRoleModuleOverrides([]);
      return NextResponse.json({ overrides: getRoleModuleOverrides() });
    }
    if (typeof body.reset === 'string') {
      if (!GOVERNED_MODULE_IDS.has(body.reset)) {
        return NextResponse.json({ error: 'Unknown module_id' }, { status: 400 });
      }
      clearRoleModuleOverrides([body.reset]);
      return NextResponse.json({ overrides: getRoleModuleOverrides() });
    }

    const { module_id, allowed_roles } = body;
    if (typeof module_id !== 'string' || !GOVERNED_MODULE_IDS.has(module_id)) {
      return NextResponse.json({ error: 'Unknown module_id' }, { status: 400 });
    }
    if (!isValidRoleArray(allowed_roles)) {
      return NextResponse.json({ error: 'allowed_roles must be a subset of staff/manager/admin' }, { status: 400 });
    }
    // Admin is never removable — matches the locked Admin column in the grid and
    // stops a module being hidden from the only role that can administer it.
    const roles = Array.from(new Set([...allowed_roles, 'admin']));
    setRoleModuleOverride(module_id, roles);
    return NextResponse.json({ overrides: getRoleModuleOverrides() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update module access';
    console.error('POST /api/admin/role-modules error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
