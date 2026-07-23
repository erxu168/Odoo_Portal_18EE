/**
 * The registry of managed lists — the single source of truth AND the allow-list.
 * A dropdown becomes user-editable ONLY by appending a descriptor here; anything
 * not listed stays fixed in code (this is what keeps structural/legal enums —
 * weekdays, statuses, payroll classes — locked). Adding a new managed list = one
 * object: it gets a generic API, an editor sheet, and a Settings-hub card for free.
 *
 * Same idiom as PERMISSION_ACTIONS in permissions.ts: a pure data array, no
 * runtime deps, safe to import on both server and client.
 */
export type ManagedSource = 'managed'; // 'odoo' adapters land in a later phase

export interface ManagedListDef {
  /** URL-safe key, e.g. 'issue-types'. Also the storage list_key. */
  key: string;
  label: string;
  description: string;
  /** Grouping in the Settings hub. */
  module: 'inventory' | 'purchase' | 'hr';
  /** 'global' = one list for the whole company (company_id 0); 'company' = per-restaurant. */
  scope: 'global' | 'company';
  source: ManagedSource;
  /** Who may WRITE: 'admin' (role), or a capability key understood by roleCan. */
  permission: 'admin' | string;
  caps: { add: boolean; rename: boolean; delete: boolean };
  /** Optional blast-radius warning shown in the editor (e.g. for global lists). */
  warn?: string;
  /** Default items seeded on first use. */
  seed?: string[];
}

export const MANAGED_LISTS: ManagedListDef[] = [
  {
    key: 'issue-types',
    label: 'Delivery issue types',
    description: 'The reasons a delivery line can be flagged when receiving an order.',
    module: 'purchase',
    scope: 'global',
    source: 'managed',
    permission: 'admin',
    caps: { add: true, rename: true, delete: true },
    warn: 'These apply when receiving deliveries at every restaurant.',
    seed: ['Missing', 'Wrong quantity', 'Damaged', 'Expired', 'Wrong item', 'Other'],
  },
  {
    key: 'skip-reasons',
    label: 'Skip-count reasons',
    description: 'The reasons staff can give when they skip a spot during a count.',
    module: 'inventory',
    scope: 'global',
    source: 'managed',
    permission: 'admin',
    caps: { add: true, rename: true, delete: true },
    warn: 'These appear during counts at every restaurant.',
    seed: ['Location was locked', 'Ran out of time', 'Nothing stored here today', 'Already counted earlier'],
  },
];

export function getManagedListDef(key: string): ManagedListDef | undefined {
  return MANAGED_LISTS.find((d) => d.key === key);
}
