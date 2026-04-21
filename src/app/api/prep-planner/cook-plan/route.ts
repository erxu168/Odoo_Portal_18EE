export const dynamic = 'force-dynamic';
/**
 * GET /api/prep-planner/cook-plan?companyId=3&date=YYYY-MM-DD
 *
 * Returns the cook-facing prep plan for the given day:
 * one row per prep item with forecast totals, peak hour, and this
 * user's existing acknowledgment (if any).
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { listPrepItems } from '@/lib/prep-planner-mapping-db';
import { listAcksForUser } from '@/lib/prep-plan-acks-db';

interface PlanItem {
  prep_item_id: number;
  name: string;
  station: string | null;
  unit: string;
  batch_size: number | null;
  forecast_qty: number;
  peak_hour: number | null;
  my_ack: {
    action: 'confirm' | 'adjust' | 'skip';
    planned_qty: number | null;
    updated_at: string;
  } | null;
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  const date = searchParams.get('date');

  const companyId = companyIdRaw ? parseInt(companyIdRaw, 10) : NaN;
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const items = listPrepItems(companyId);
  const db = getDb();

  // Aggregate forecast rows for this company + date
  const forecastRows = db.prepare(`
    SELECT prep_item_id, target_hour, forecast_portions
    FROM prep_item_forecasts
    WHERE company_id = ? AND target_date = ?
  `).all(companyId, date) as { prep_item_id: number; target_hour: number; forecast_portions: number }[];

  const totalByItem = new Map<number, { total: number; peakHour: number | null; peakVal: number }>();
  for (const row of forecastRows) {
    let agg = totalByItem.get(row.prep_item_id);
    if (!agg) {
      agg = { total: 0, peakHour: null, peakVal: 0 };
      totalByItem.set(row.prep_item_id, agg);
    }
    agg.total += row.forecast_portions;
    if (row.forecast_portions > agg.peakVal) {
      agg.peakVal = row.forecast_portions;
      agg.peakHour = row.target_hour;
    }
  }

  // Existing acks for this user + date
  const acks = listAcksForUser(user.id, date);
  const ackByItem = new Map(acks.map(a => [a.prep_item_id, a]));

  // Only include items with a forecast > 0
  const plan: PlanItem[] = [];
  for (const item of items) {
    const agg = totalByItem.get(item.id);
    if (!agg || agg.total <= 0) continue;
    const ack = ackByItem.get(item.id);
    plan.push({
      prep_item_id: item.id,
      name: item.name,
      station: item.station,
      unit: item.unit,
      batch_size: item.batch_size,
      forecast_qty: Math.round(agg.total * 100) / 100,
      peak_hour: agg.peakHour,
      my_ack: ack ? {
        action: ack.action,
        planned_qty: ack.planned_qty,
        updated_at: ack.updated_at,
      } : null,
    });
  }

  // Sort: unacknowledged first (by peak hour), then acknowledged
  plan.sort((a, b) => {
    if (!a.my_ack && b.my_ack) return -1;
    if (a.my_ack && !b.my_ack) return 1;
    return (a.peak_hour ?? 99) - (b.peak_hour ?? 99);
  });

  const pendingCount = plan.filter(p => !p.my_ack).length;

  return NextResponse.json({
    date,
    companyId,
    items: plan,
    pendingCount,
    totalCount: plan.length,
  });
}
