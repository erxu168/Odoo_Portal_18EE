/**
 * Canonical list of per-action permissions an admin can grant/revoke per role.
 *
 * Access model:
 *  - Each action has a set of default roles = TODAY's behavior.
 *  - An admin override (stored in the feature_permissions table, passed here as a
 *    plain map) replaces the default for that one action.
 *  - `permissions.manage` (the action that controls the Permissions screen itself)
 *    is HARD-LOCKED to admin and can never be overridden — prevents lockout.
 *  - An unknown key fails closed (admin-only) so a typo can never open access.
 *
 * This file is pure logic (no DB import) so it is trivially unit-testable and is the
 * single source of truth used by BOTH the server guard and the UI.
 */
export type Role = 'staff' | 'manager' | 'admin';
export const ALL_ROLES: Role[] = ['staff', 'manager', 'admin'];

export interface PermissionAction {
  key: string;        // stable id: "<module>.<object>.<verb>"
  module: string;     // module id (matches ids in modules.ts / dashboard tiles)
  label: string;      // plain-English label shown on the screen
  group?: string;     // optional sub-heading within a module
  defaultRoles: Role[];
}

export type PermissionOverrides = Record<string, Role[]>;

/** The action that governs the Permissions screen. Always admin-only, never editable. */
export const PERMISSIONS_MANAGE_KEY = 'permissions.manage';

export const PERMISSION_ACTIONS: PermissionAction[] = [
  // ── Shifts (Release 1) — 11 capabilities, finalized from the audit ───
  // Each maps to real guarded routes (see plan Task 7 mapping table).
  { key: 'shifts.schedule.view',      module: 'shifts', label: 'View schedule & own shifts',                          defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'shifts.selfservice.submit', module: 'shifts', label: 'Claim / confirm / swap / report sick (self-service)', defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'shifts.shift.manage',       module: 'shifts', label: 'Create & edit shifts',                                defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.shift.delete',       module: 'shifts', label: 'Delete a shift / series',                             defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.schedule.publish',   module: 'shifts', label: 'Publish a schedule',                                  defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.pattern.manage',     module: 'shifts', label: 'Manage patterns & runs',                              defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.rostercaps.manage',  module: 'shifts', label: 'Manage roster caps',                                  defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.requests.approve',   module: 'shifts', label: 'Approve requests / swaps / sick',                     defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.rolesdept.manage',   module: 'shifts', label: 'Manage roles & departments',                          defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.settings.manage',    module: 'shifts', label: 'Edit shift settings',                                 defaultRoles: ['manager', 'admin'] },
  { key: 'shifts.overview.view',      module: 'shifts', label: 'View manager overviews & KPIs',                       defaultRoles: ['manager', 'admin'] },
];

export function actionByKey(key: string): PermissionAction | undefined {
  return PERMISSION_ACTIONS.find((a) => a.key === key);
}

export function isValidRoleArray(x: unknown): x is Role[] {
  return Array.isArray(x) && x.every((r) => r === 'staff' || r === 'manager' || r === 'admin');
}

/** Effective allowed roles for an action: the admin override if present, else the default. */
export function allowedRolesFor(key: string, overrides: PermissionOverrides): Role[] {
  if (key === PERMISSIONS_MANAGE_KEY) return ['admin']; // hard-locked
  const override = overrides[key];
  if (isValidRoleArray(override)) return override;
  return actionByKey(key)?.defaultRoles ?? ['admin']; // unknown key = admin-only, fail closed
}

export function roleCan(role: Role, key: string, overrides: PermissionOverrides): boolean {
  return allowedRolesFor(key, overrides).includes(role);
}

export function allowedActionKeysForRole(role: Role, overrides: PermissionOverrides): string[] {
  return PERMISSION_ACTIONS
    .map((a) => a.key)
    .filter((key) => roleCan(role, key, overrides));
}
