import { LOCATIONS } from '@/types/purchase';
import { canAccessCompany } from '@/lib/inventory-access';
import { parseCompanyIds } from '@/lib/db';
import type { getCurrentUser } from '@/lib/auth';

/**
 * Purchase authorization by stock-location. The purchase module keys everything
 * off a stock.location id (Ssam=32→company 3, GBM38=22→company 2, see
 * types/purchase LOCATIONS). Because portal roles are GLOBAL, a mutating/reading
 * route that trusts a client-supplied location_id/order_id/cart_id must resolve
 * it to a company and confirm the caller is allowed that restaurant — otherwise
 * a manager of one restaurant can act on another's orders/guides/inventory.
 */
export function companyForPurchaseLocation(locationId: number): number | null {
  const loc = Object.values(LOCATIONS).find((l) => l.id === locationId);
  return loc ? loc.company_id : null;
}

/** True when `user` may act on the restaurant that owns this purchase location. */
export function canAccessPurchaseLocation(
  user: NonNullable<ReturnType<typeof getCurrentUser>>,
  locationId: number,
): boolean {
  const companyId = companyForPurchaseLocation(locationId);
  if (companyId == null) return false;   // unknown location → deny
  return canAccessCompany(user, companyId);
}

/** True only for a full admin with NO company restriction (cross-company by
 *  design). Global destructive ops on SHARED data require this, not a
 *  company-scoped admin. */
export function isUnrestrictedAdmin(user: NonNullable<ReturnType<typeof getCurrentUser>>): boolean {
  return user.role === 'admin' && parseCompanyIds(user.allowed_company_ids).length === 0;
}
