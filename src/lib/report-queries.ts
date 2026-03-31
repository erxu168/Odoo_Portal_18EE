/**
 * Krawings Report Builder — Odoo Query Layer
 * 
 * All raw Odoo JSON-RPC queries used by the report engine.
 * Each function returns typed data from a single Odoo model.
 * 
 * IMPORTANT: All dates in Odoo are UTC. Berlin is UTC+1/+2.
 * We offset when building domain filters so Berlin dates work correctly.
 */

import { getOdoo } from './odoo';
import type { LocationInfo } from '@/types/reports';

// ── LOCATION CONFIG ─────────────────────────────────────

export const LOCATIONS: LocationInfo[] = [
  { id: 7, name: 'Gogi Boss M38', companyId: 2, companyName: 'Krawings', type: 'counter', active: true },
  { id: 8, name: 'Ssam Korean BBQ', companyId: 3, companyName: 'Ssam Korean BBQ, Inh. Ruo Xu', type: 'sitdown', active: true },
  { id: 2, name: 'Ssam Warschauerstra\u00DFe', companyId: 1, companyName: 'Ssam Warschauerstra\u00DFe GmbH', type: 'sitdown', active: false },
];

export function getLocation(configId: number): LocationInfo | undefined {
  return LOCATIONS.find(l => l.id === configId);
}

export function getLocationByCompany(companyId: number): LocationInfo | undefined {
  return LOCATIONS.find(l => l.companyId === companyId);
}

export function getActiveLocations(): LocationInfo[] {
  return LOCATIONS.filter(l => l.active);
}

// ── DATE HELPERS ────────────────────────────────────────

export function berlinToUtc(dateStr: string, endOfDay = false): string {
  const d = new Date(dateStr + (endOfDay ? 'T23:59:59' : 'T00:00:00') + '+01:00');
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function monthEnd(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
}

export function weekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().substring(0, 10);
}

export function weekEnd(dateStr: string): string {
  const start = new Date(weekStart(dateStr));
  start.setDate(start.getDate() + 6);
  return start.toISOString().substring(0, 10);
}

// ── RAW QUERIES ─────────────────────────────────────────

export async function fetchOrders(
  companyId: number,
  startDate: string,
  endDate: string,
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'pos.order',
    [
      ['company_id', '=', companyId],
      ['date_order', '>=', berlinToUtc(startDate)],
      ['date_order', '<', berlinToUtc(endDate, true)],
      ['state', 'in', ['paid', 'done', 'invoiced']],
    ],
    [
      'name', 'date_order', 'amount_total', 'amount_tax', 'tip_amount',
      'customer_count', 'table_id', 'employee_id', 'company_id',
      'config_id', 'state', 'has_deleted_line', 'partner_id',
    ],
    { limit: 0, order: 'date_order asc' },
  );
}

export async function fetchRefunds(
  companyId: number,
  startDate: string,
  endDate: string,
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'pos.order',
    [
      ['company_id', '=', companyId],
      ['amount_total', '<', 0],
      ['date_order', '>=', berlinToUtc(startDate)],
      ['date_order', '<', berlinToUtc(endDate, true)],
    ],
    ['name', 'date_order', 'amount_total', 'employee_id', 'state'],
    { limit: 0 },
  );
}

export async function fetchOrderLines(
  companyId: number,
  startDate: string,
  endDate: string,
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'pos.order.line',
    [
      ['order_id.company_id', '=', companyId],
      ['order_id.date_order', '>=', berlinToUtc(startDate)],
      ['order_id.date_order', '<', berlinToUtc(endDate, true)],
      ['order_id.state', 'in', ['paid', 'done', 'invoiced']],
    ],
    ['order_id', 'product_id', 'qty', 'price_subtotal', 'price_subtotal_incl', 'discount'],
    { limit: 0 },
  );
}

export async function fetchPayments(
  companyId: number,
  startDate: string,
  endDate: string,
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'pos.payment',
    [
      ['company_id', '=', companyId],
      ['payment_date', '>=', berlinToUtc(startDate)],
      ['payment_date', '<', berlinToUtc(endDate, true)],
    ],
    ['pos_order_id', 'payment_method_id', 'amount', 'payment_date'],
    { limit: 0 },
  );
}

export async function fetchSessions(
  configId: number,
  limit = 30,
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'pos.session',
    [
      ['config_id', '=', configId],
      ['state', '=', 'closed'],
    ],
    [
      'name', 'start_at', 'stop_at', 'cash_register_difference',
      'order_count', 'total_payments_amount', 'config_id',
    ],
    { limit, order: 'start_at desc' },
  );
}

export async function fetchAccountMoveLines(
  companyId: number,
  startDate: string,
  endDate: string,
  accountTypes: string[],
) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'account.move.line',
    [
      ['company_id', '=', companyId],
      ['date', '>=', startDate],
      ['date', '<=', endDate],
      ['parent_state', '=', 'posted'],
      ['account_id.account_type', 'in', accountTypes],
    ],
    ['account_id', 'debit', 'credit', 'name'],
    { limit: 0 },
  );
}

export async function fetchTables(configId: number) {
  const odoo = getOdoo();
  return odoo.searchRead(
    'restaurant.table',
    [['floor_id.pos_config_ids', 'in', [configId]]],
    ['seats', 'floor_id'],
    { limit: 100 },
  );
}

export async function fetchProducts(productIds: number[]) {
  if (productIds.length === 0) return [];
  const odoo = getOdoo();
  const chunks: number[][] = [];
  for (let i = 0; i < productIds.length; i += 100) {
    chunks.push(productIds.slice(i, i + 100));
  }
  const results = await Promise.all(
    chunks.map(chunk =>
      odoo.searchRead(
        'product.product',
        [['id', 'in', chunk]],
        ['name', 'categ_id'],
        { limit: 100 },
      ),
    ),
  );
  return results.flat();
}
