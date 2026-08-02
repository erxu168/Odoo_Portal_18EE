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
  /** Where the dashboard tile / nav link goes. null = a "coming soon" placeholder. */
  href: string | null;
  /** Dashboard tile + (fallback) nav icon. */
  emoji: string;
  /** Dashboard tile subtitle. */
  subtitle: string;
  /** Chef Guide has cooking vs production variants that share /recipes. */
  scope?: 'cooking' | 'production';
  /** false = governed for access but NOT shown as a dashboard tile (e.g. Termination). */
  tile?: boolean;
  /** Hamburger placement: 'nav' (default) or 'admin'. */
  drawer?: 'nav' | 'admin';
}

/**
 * THE single source of truth for the portal's modules. Both the dashboard tiles
 * (DashboardHome) and the hamburger nav (AppDrawer) derive their list from this,
 * so they can never drift — add a module here and it appears in BOTH, gated by the
 * same per-user access. Order here = the default dashboard tile order.
 */
export const PORTAL_MODULES: PortalModule[] = [
  { id: 'shift-handover',   label: 'Shift Handover',   minRole: 'staff',   href: '/shift-handover', emoji: '🔄', subtitle: 'Notes & photos for the next shift' },
  { id: 'production',       label: 'Manufacturing',    minRole: 'staff',   href: '/manufacturing',  emoji: '🏭', subtitle: 'Prep & production orders' },
  { id: 'recipes',         label: 'Chef Guide',       minRole: 'staff',   href: '/recipes',        emoji: '👨‍🍳', subtitle: 'Cooking guides', scope: 'cooking' },
  { id: 'production-guide', label: 'Production Guide', minRole: 'manager', href: '/recipes',        emoji: '🥫', subtitle: 'Sauces, prep & batches', scope: 'production' },
  { id: 'inventory',       label: 'Inventory',        minRole: 'staff',   href: '/inventory',      emoji: '📦', subtitle: 'Stock counting & tracking' },
  { id: 'labels',          label: 'Label Printer',    minRole: 'staff',   href: '/labels',         emoji: '🖨️', subtitle: 'Print food & shelf labels' },
  { id: 'waste',           label: 'Waste Tracker',    minRole: 'staff',   href: '/waste',          emoji: '🗑️', subtitle: 'Log & track kitchen waste' },
  { id: 'products',        label: 'Products',         minRole: 'manager', href: '/products',       emoji: '🏷️', subtitle: 'Catalog, units & photos' },
  { id: 'purchase',        label: 'Purchase',         minRole: 'staff',   href: '/purchase',       emoji: '🛒', subtitle: 'Orders & suppliers' },
  { id: 'shifts',          label: 'Planning',         minRole: 'staff',   href: '/shifts',         emoji: '📅', subtitle: 'Shifts, claims & covers' },
  { id: 'tasks',           label: 'My Tasks',         minRole: 'staff',   href: '/tasks',          emoji: '✅', subtitle: 'Daily department checklist' },
  { id: 'prep-planner',    label: 'Prep Planner',     minRole: 'manager', href: '/prep-planner',   emoji: '📊', subtitle: 'Demand forecasts & prep targets' },
  { id: 'cooktimer',       label: 'Cooking Timer',    minRole: 'manager', href: '/cooktimer-setup', emoji: '🍳', subtitle: 'Stations & cook profiles' },
  { id: 'sales',           label: 'Sales',            minRole: 'manager', href: '/sales',          emoji: '📈', subtitle: 'What a Jerk revenue & top sellers' },
  { id: 'hr',              label: 'HR',               minRole: 'staff',   href: '/hr',             emoji: '👤', subtitle: 'Profile & onboarding' },
  { id: 'rentals',         label: 'Rentals',          minRole: 'admin',   href: '/rentals',        emoji: '🏠', subtitle: 'Properties & tenancies' },
  { id: 'credentials',     label: 'Supplier Logins',  minRole: 'manager', href: '/admin/credentials', emoji: '🔑', subtitle: 'Vendor credentials', drawer: 'admin' },
  { id: 'tablets',         label: 'Shared Tablets',   minRole: 'manager', href: '/admin/tablets',  emoji: '📱', subtitle: 'Kitchen tablet access', drawer: 'admin' },
  { id: 'termination',     label: 'Termination',      minRole: 'admin',   href: '/hr/termination', emoji: '📄', subtitle: 'Offboarding & documents', tile: false, drawer: 'admin' },
];

/** Modules shown as dashboard tiles (everything except tile:false). */
export const DASHBOARD_MODULES = PORTAL_MODULES.filter((m) => m.tile !== false);
/** Modules shown in the hamburger's "Navigate" section (not the Admin group). */
export const NAV_MODULES = PORTAL_MODULES.filter((m) => (m.drawer ?? 'nav') === 'nav' && m.href);

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
