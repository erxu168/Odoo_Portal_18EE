/**
 * GET /api/purchase/alerts
 * Returns:
 *  - upcoming public holidays (Berlin) within 7-day window
 *  - per-supplier order deadline alerts based on delivery_days + lead_time_days
 *
 * Query params:
 *  - location_id (optional, filters suppliers)
 *  - window (optional, default 7 — how many days ahead to check holidays)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUpcomingHolidays, computeSupplierDeadline } from '@/lib/purchase-holidays';
import { listSuppliers } from '@/lib/purchase-db';

function parseDays(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr.map((d: string) => d.toLowerCase());
  } catch { /* ignore */ }
  return [];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationId = sp.get('location_id') ? Number(sp.get('location_id')) : undefined;
  const window = sp.get('window') ? Number(sp.get('window')) : 7;

  // Use Berlin timezone for "today"
  const nowBerlin = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  // Zero out time
  const today = new Date(nowBerlin.getFullYear(), nowBerlin.getMonth(), nowBerlin.getDate());

  // 1. Upcoming holidays
  const holidays = getUpcomingHolidays(today, window);

  // 2. Supplier deadline alerts
  const suppliers = listSuppliers(locationId) as any[];
  const deadlines = suppliers
    .map((s) => {
      const deliveryDays = parseDays(s.delivery_days || '[]');
      const orderDays = parseDays(s.order_days || '[]');
      if (deliveryDays.length === 0) return null; // local/daily suppliers — no deadline
      return computeSupplierDeadline(
        s.id,
        s.name,
        deliveryDays,
        orderDays,
        s.lead_time_days || 1,
        today,
      );
    })
    .filter(Boolean)
    // Sort: most urgent first
    .sort((a: any, b: any) => a.daysUntilDeadline - b.daysUntilDeadline);

  return NextResponse.json({
    today: today.toISOString().split('T')[0],
    holidays,
    deadlines,
  });
}
