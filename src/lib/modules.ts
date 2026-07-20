/**
 * Canonical list of portal modules that admins can grant/revoke per user.
 *
 * Access model:
 *  - Each module has a default minimum role.
 *  - A user with no explicit `module_access` sees their role's default set.
 *  - Once an admin customises a user, `module_access` is an explicit allowlist
 *    of module ids and role no longer decides visibility for that user.
 *
 * Module ids MUST match the tile / nav ids used in DashboardHome + AppDrawer.
 * Placeholder tiles (e.g. "coming soon") are intentionally NOT listed here, so
 * they stay visible and are not governed by per-user access.
 */
export interface PortalModule {
  id: string;
  label: string;
  minRole: 'staff' | 'manager' | 'admin';
}

export const PORTAL_MODULES: PortalModule[] = [
  { id: 'production', label: 'Manufacturing', minRole: 'staff' },
  { id: 'recipes', label: 'Chef Guide', minRole: 'staff' },
  { id: 'production-guide', label: 'Production Guide', minRole: 'manager' },
  { id: 'inventory', label: 'Inventory', minRole: 'staff' },
  { id: 'shift-handover', label: 'Shift Handover', minRole: 'staff' },
  { id: 'purchase', label: 'Purchase', minRole: 'staff' },
  { id: 'hr', label: 'HR', minRole: 'staff' },
  { id: 'tasks', label: 'My Tasks', minRole: 'staff' },
  { id: 'shifts', label: 'Shifts', minRole: 'staff' },
  { id: 'prep-planner', label: 'Prep Planner', minRole: 'manager' },
  { id: 'sales', label: 'Sales', minRole: 'manager' },
  { id: 'credentials', label: 'Supplier Logins', minRole: 'manager' },
  { id: 'tablets', label: 'Shared Tablets', minRole: 'manager' },
  { id: 'termination', label: 'Termination', minRole: 'admin' },
  { id: 'rentals', label: 'Rentals', minRole: 'admin' },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

/** Ids of modules governed by per-user access control. */
export const GOVERNED_MODULE_IDS = new Set(PORTAL_MODULES.map(m => m.id));

/** Modules a role sees by default (used when a user has no explicit access set). */
export function defaultModuleIds(role: string): string[] {
  const lvl = ROLE_LEVEL[role] || 1;
  return PORTAL_MODULES.filter(m => lvl >= (ROLE_LEVEL[m.minRole] || 1)).map(m => m.id);
}

/** Parse the stored module_access value (JSON array) into ids, or null if unset. */
export function parseModuleAccess(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === '') return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** Effective allowed module ids: the explicit allowlist if set, else the role default. */
export function effectiveModuleIds(role: string, moduleAccess: string | null | undefined): string[] {
  const explicit = parseModuleAccess(moduleAccess);
  return explicit != null ? explicit : defaultModuleIds(role);
}
