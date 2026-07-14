/**
 * Purchase module access model — mirrors Choco's 3 team levels, mapped onto the
 * portal's Admin > Manager > Staff roles.
 *
 *   Admin   — everything: edit templates, manage suppliers & team, order, receive, approve.
 *   Manager — edit templates, manage suppliers, order, receive, approve deliveries.
 *   Staff   — place orders and receive deliveries; templates are view-only.
 *
 * This is the single source of truth for "who can do what" in Purchase.
 */
export type PurchaseRole = 'admin' | 'manager' | 'staff';

export function purchaseRole(user: { role?: string } | null | undefined): PurchaseRole {
  const r = (user?.role || 'staff').toLowerCase();
  return r === 'admin' ? 'admin' : r === 'manager' ? 'manager' : 'staff';
}

export const purchaseCan = {
  editTemplates: (r: PurchaseRole) => r === 'admin' || r === 'manager',
  manageSuppliers: (r: PurchaseRole) => r === 'admin' || r === 'manager',
  approveDeliveries: (r: PurchaseRole) => r === 'admin' || r === 'manager',
  manageTeam: (r: PurchaseRole) => r === 'admin',
  placeOrders: (_r: PurchaseRole) => true,
  receiveDeliveries: (_r: PurchaseRole) => true,
};

/** Human-readable access levels — used to make "who can edit templates" explicit in the UI. */
export const PURCHASE_ACCESS_LEVELS: { role: string; summary: string }[] = [
  { role: 'Admin', summary: 'Everything: templates, suppliers, team & approvals' },
  { role: 'Manager', summary: 'Edit templates, order, receive, approve deliveries' },
  { role: 'Staff', summary: 'Place orders & receive; templates are view-only' },
];
