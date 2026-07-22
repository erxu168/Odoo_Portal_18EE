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

// Overrides come from the DB as plain string arrays (unvalidated). The pure
// functions below validate each entry with isValidRoleArray, so the loose type
// is intentional — it lets DB output flow in without a cast.
export type PermissionOverrides = Record<string, string[]>;

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

  // ── Manufacturing (proving-ground module) — defaults match today's guards ───
  // create/manage/BOM-edit/shelf-life/tolerance/archive are requireRole('manager') today
  // → manager+admin. components/save-version/set-current are requireAuth (any logged-in
  // user) today → all roles (behavior-preserving; now enforceable). No company scope here.
  { key: 'manufacturing.mo.create',       module: 'manufacturing', label: 'Create a manufacturing order',             defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.mo.manage',       module: 'manufacturing', label: 'Confirm / close / cancel / edit orders',    defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.mo.components',   module: 'manufacturing', label: 'Add / edit / remove order ingredients',     defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'manufacturing.mo.saveversion',  module: 'manufacturing', label: 'Save an order as a new recipe version',     defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'manufacturing.bom.create',      module: 'manufacturing', label: 'Create a recipe (BOM)',                     defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.bom.edit',        module: 'manufacturing', label: 'Edit a recipe (BOM) & worksheets',          defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.bom.setcurrent',  module: 'manufacturing', label: 'Set the current recipe version',            defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'manufacturing.bom.archive',     module: 'manufacturing', label: 'Archive / unarchive a recipe',              defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.shelflife.edit',  module: 'manufacturing', label: 'Edit shelf life',                           defaultRoles: ['manager', 'admin'] },
  { key: 'manufacturing.tolerance.manage', module: 'manufacturing', label: 'Set recipe tolerance',                     defaultRoles: ['manager', 'admin'] },

  // ── Purchase — defaults match today's guards (inline hasRole; no company scope) ───
  // supplier/guide/product/insights/receive-confirm/order-approve = hasRole('manager')
  // → manager+admin. seed/auto-import = hasRole('admin') → admin. Placing an order today
  // has NO role gate (any logged-in user) → order.send defaults to all roles (now enforceable).
  { key: 'purchase.order.send',      module: 'purchase', label: 'Place / send an order to a supplier',   defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'purchase.supplier.manage', module: 'purchase', label: 'Add / edit / remove suppliers',         defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.guide.manage',    module: 'purchase', label: 'Edit order guides (items, prices)',      defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.product.manage',  module: 'purchase', label: 'Search & create products',              defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.insights.view',   module: 'purchase', label: 'View spend insights',                   defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.receive.confirm', module: 'purchase', label: 'Approve a receipt into stock',           defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.order.approve',   module: 'purchase', label: 'Approve / reject a queued order',        defaultRoles: ['manager', 'admin'] },
  { key: 'purchase.suppliers.seed',  module: 'purchase', label: 'Seed / auto-import suppliers from Odoo', defaultRoles: ['admin'] },

  // ── Inventory — defaults match today's guards (inline hasRole; no company auth gate) ───
  // review/draft/template/consumption/product-settings = hasRole('manager') → manager+admin.
  // Creating a product via scan today has NO role gate (any logged-in) → all roles (now enforceable).
  // Counting/submitting/quick-count stay all-roles (unchanged, not gated here). locations stays a
  // company-scoped view (allowed_company_ids filter preserved).
  { key: 'inventory.review.approve',        module: 'inventory', label: 'Approve / reject / reopen counts (into stock)', defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.draft.review',          module: 'inventory', label: 'Review draft products (approve / link / reject)', defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.template.manage',       module: 'inventory', label: 'Create & assign count lists',                     defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.consumption.view',      module: 'inventory', label: 'View consumption report',                        defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.productsettings.manage', module: 'products', label: 'Edit product settings (name, unit, packs, photo)', defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.location.manage',       module: 'inventory', label: 'Set up count locations (map, shelves, photos)',     defaultRoles: ['manager', 'admin'] },
  { key: 'inventory.product.create',        module: 'inventory', label: 'Create a product via scan',                      defaultRoles: ['staff', 'manager', 'admin'] },
  // Behavior-preserving keys for tiles that were hard-coded before (staff saw MO
  // Ingredients; drinks tools were manager+). Defaults = today's behavior; an
  // admin can now adjust them per role like every other action.
  { key: 'inventory.moingredients.view',    module: 'inventory', label: 'View MO ingredient needs',                       defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'inventory.drinks.manage',         module: 'inventory', label: 'Scan & edit POS drinks',                         defaultRoles: ['manager', 'admin'] },

  // ── Prep Planner — a manager-only module (nav tile minRole=manager). Its item/link/forecast
  // API routes had NO server auth at all (open hole); gating them to manager+admin matches the
  // intended manager-only reality AND closes the hole. 'run' was already hasRole('manager').
  { key: 'prep-planner.forecast.run',  module: 'prep-planner', label: 'Run the prep forecast',            defaultRoles: ['manager', 'admin'] },
  { key: 'prep-planner.forecast.view', module: 'prep-planner', label: 'View forecasts, items & variance', defaultRoles: ['manager', 'admin'] },
  { key: 'prep-planner.item.manage',   module: 'prep-planner', label: 'Create & edit prep items',         defaultRoles: ['manager', 'admin'] },
  { key: 'prep-planner.item.delete',   module: 'prep-planner', label: 'Delete a prep item',               defaultRoles: ['manager', 'admin'] },
  { key: 'prep-planner.link.manage',   module: 'prep-planner', label: 'Link / unlink POS products',       defaultRoles: ['manager', 'admin'] },

  // ── Chef Guide / Production Guide (recipes) — approve/publish/featured/ingredients = manager
  // (inline hasRole or requireRole today) → manager+admin; delete = admin. View/cook routes stay
  // all-roles (requireAuth, untouched).
  { key: 'recipes.approve',            module: 'recipes', label: 'Approve a recipe',                 defaultRoles: ['manager', 'admin'] },
  { key: 'recipes.publish',            module: 'recipes', label: 'Publish a recipe',                 defaultRoles: ['manager', 'admin'] },
  { key: 'recipes.ingredients.manage', module: 'recipes', label: 'Edit recipe ingredients',          defaultRoles: ['manager', 'admin'] },
  { key: 'recipes.featured.manage',    module: 'recipes', label: 'Manage featured dishes',           defaultRoles: ['manager', 'admin'] },
  { key: 'recipes.delete',             module: 'recipes', label: 'Delete a recipe',                  defaultRoles: ['admin'] },

  // ── Supplier Logins (credentials) — view = manager (hasRole 'manager'); add/edit/delete = admin
  // (hasRole 'admin'). The admins-see-all data-scoping in the GET is preserved.
  { key: 'credentials.view',   module: 'credentials', label: 'View supplier logins',              defaultRoles: ['manager', 'admin'] },
  { key: 'credentials.manage', module: 'credentials', label: 'Add / edit / delete supplier logins', defaultRoles: ['admin'] },

  // ── My Tasks — all manager actions are requireRole('manager') today → manager+admin. Staff
  // task-doing (complete POST, note, photo, subtask, view today/list) stays requireAuth (all roles).
  { key: 'tasks.template.manage',     module: 'tasks', label: 'Manage checklists & templates',       defaultRoles: ['manager', 'admin'] },
  { key: 'tasks.completion.override', module: 'tasks', label: 'Override a task completion',           defaultRoles: ['manager', 'admin'] },
  { key: 'tasks.manager.view',        module: 'tasks', label: 'View team task dashboard & history',   defaultRoles: ['manager', 'admin'] },

  // ── Staff Lifecycle Checklists (HR: Joining / Promotion / Leaving). Master-list
  // editing is admin-only in v1; running & ticking checklists is manager+admin.
  { key: 'staffing.templates.manage', module: 'hr', label: 'Set up lifecycle checklists (master lists)', defaultRoles: ['admin'] },
  { key: 'staffing.instances.manage', module: 'hr', label: 'Start & manage lifecycle checklists',        defaultRoles: ['manager', 'admin'] },
  // Drives the drill-down into a staff member's canonical record page (PII/DATEV).
  // The API separately enforces company scope + the admin-only login-email rule.
  { key: 'hr.employee.manage',        module: 'hr', label: 'View & edit staff records (personal / DATEV data)', defaultRoles: ['manager', 'admin'] },

  // ── Shift Handover — the shift LOG (portal-only). The outgoing shift posts notes,
  // photos and storage; the next shift reads them. Everyone reads + posts; editing
  // other people's notes and managing the log types is manager work.
  { key: 'handover.view',              module: 'shift-handover', label: 'See the shift log',                          defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'handover.production.record', module: 'shift-handover', label: 'Post notes, photos & storage',                defaultRoles: ['staff', 'manager', 'admin'] },
  { key: 'handover.configure',         module: 'shift-handover', label: 'Edit anyone’s notes & manage log types', defaultRoles: ['manager', 'admin'] },

  // ── KDS Cooking Timer — station tablet timers (queue/start/advance are the staff
  // tablet, unauthenticated device endpoints). Only the SETUP screen (stations +
  // per-product cook profiles & step chains) is manager work. ──
  { key: 'cooktimer.config.manage',         module: 'cooktimer', label: 'Set up cooking-timer stations & profiles',             defaultRoles: ['manager', 'admin'] },
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
