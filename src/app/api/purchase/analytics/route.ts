/**
 * GET /api/purchase/analytics?location_id=X&month=YYYY-MM
 * Spend insights for Manage Purchases (manager+).
 *
 * Counts only orders that actually went out:
 *   status IN ('sent', 'received', 'partial')
 *
 * Returns totals for the requested month + the previous month (for a
 * month-over-month delta), plus top suppliers and top categories for the
 * requested month.
 *
 * Category is resolved from purchase_guide_items by product_id (picks any
 * guide entry for that product). If a product_id never appeared in a guide,
 * category falls back to 'Other'.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getDb } from '@/lib/db';

const COUNTED_STATUSES = ['sent', 'received', 'partial'];

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // month is 1-indexed input; go back 1
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function currentMonthISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const locationId = parseInt(searchParams.get('location_id') || '0');
  const month = searchParams.get('month') || currentMonthISO();
  if (!locationId) return NextResponse.json({ error: 'location_id required' }, { status: 400 });
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });

  const prev = prevMonth(month);
  const db = getDb();
  const statusPlaceholders = COUNTED_STATUSES.map(() => '?').join(',');

  const monthTotal = (db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS n
       FROM purchase_orders
      WHERE location_id = ?
        AND status IN (${statusPlaceholders})
        AND substr(created_at, 1, 7) = ?`
  ).get(locationId, ...COUNTED_STATUSES, month)) as { total: number; n: number };

  const prevTotal = (db.prepare(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM purchase_orders
      WHERE location_id = ?
        AND status IN (${statusPlaceholders})
        AND substr(created_at, 1, 7) = ?`
  ).get(locationId, ...COUNTED_STATUSES, prev)) as { total: number };

  const topSuppliers = db.prepare(
    `SELECT s.id AS supplier_id, s.name AS supplier_name,
            COALESCE(SUM(o.total_amount), 0) AS total,
            COUNT(o.id) AS orders
       FROM purchase_orders o
       JOIN purchase_suppliers s ON s.id = o.supplier_id
      WHERE o.location_id = ?
        AND o.status IN (${statusPlaceholders})
        AND substr(o.created_at, 1, 7) = ?
      GROUP BY s.id
      ORDER BY total DESC
      LIMIT 5`
  ).all(locationId, ...COUNTED_STATUSES, month) as { supplier_id: number; supplier_name: string; total: number; orders: number }[];

  const topCategories = db.prepare(
    `SELECT COALESCE(
              (SELECT gi.category_name FROM purchase_guide_items gi
                WHERE gi.product_id = ol.product_id
                  AND gi.category_name != ''
                LIMIT 1),
              'Other'
            ) AS category_name,
            COALESCE(SUM(ol.subtotal), 0) AS total
       FROM purchase_order_lines ol
       JOIN purchase_orders o ON o.id = ol.order_id
      WHERE o.location_id = ?
        AND o.status IN (${statusPlaceholders})
        AND substr(o.created_at, 1, 7) = ?
      GROUP BY category_name
      ORDER BY total DESC
      LIMIT 5`
  ).all(locationId, ...COUNTED_STATUSES, month) as { category_name: string; total: number }[];

  return NextResponse.json({
    month,
    prev_month: prev,
    month_total: monthTotal.total,
    month_orders: monthTotal.n,
    prev_month_total: prevTotal.total,
    delta_abs: monthTotal.total - prevTotal.total,
    delta_pct: prevTotal.total > 0 ? ((monthTotal.total - prevTotal.total) / prevTotal.total) * 100 : null,
    top_suppliers: topSuppliers,
    top_categories: topCategories,
  });
}
