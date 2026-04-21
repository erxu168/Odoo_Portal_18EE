export const dynamic = 'force-dynamic';
/**
 * GET /api/prep-planner/variance?companyId=3&date=YYYY-MM-DD
 *
 * Compares forecast portions (from prep_item_forecasts) to actual portions
 * projected from prep_demand_history via prep_pos_link portions_per_sale ratios,
 * for a given day.
 *
 * Response includes per-item totals + per-hour breakdown, plus a list of POS
 * products that sold on the date but are not linked to any prep item.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  listPrepItems,
  listAllLinksForCompany,
} from '@/lib/prep-planner-mapping-db';

interface HourBucket { hour: number; forecast: number; actual: number }

interface ItemVariance {
  prep_item_id: number;
  name: string;
  station: string | null;
  unit: string;
  batch_size: number | null;
  forecast: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  byHour: HourBucket[];
}

export async function GET(request: Request) {
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

  const db = getDb();

  // 1. Active prep items for company
  const items = listPrepItems(companyId);

  // 2. Forecast rows for the date (prep-item level, latest run only per item×hour)
  //    prep_item_forecasts UNIQUE(prep_item_id, target_date, target_hour) keeps the latest run.
  const forecastRows = db.prepare(`
    SELECT prep_item_id, target_hour, forecast_portions
    FROM prep_item_forecasts
    WHERE company_id = ? AND target_date = ?
  `).all(companyId, date) as { prep_item_id: number; target_hour: number; forecast_portions: number }[];

  // 3. All active links for the company
  const links = listAllLinksForCompany(companyId);
  // posId -> array of { prep_item_id, portions_per_sale }
  const linkIndex = new Map<number, { prep_item_id: number; portions_per_sale: number }[]>();
  for (const link of links) {
    let arr = linkIndex.get(link.pos_product_id);
    if (!arr) {
      arr = [];
      linkIndex.set(link.pos_product_id, arr);
    }
    arr.push({ prep_item_id: link.prep_item_id, portions_per_sale: link.portions_per_sale });
  }

  // 4. Actual POS demand for the date
  const demandRows = db.prepare(`
    SELECT product_id, product_name, sale_hour, qty
    FROM prep_demand_history
    WHERE company_id = ? AND sale_date = ?
  `).all(companyId, date) as { product_id: number; product_name: string; sale_hour: number; qty: number }[];

  // 5. Build per-item, per-hour actual buckets
  // key: `${prep_item_id}|${hour}` -> actual portions
  const actualByKey = new Map<string, number>();
  const unmappedTotals = new Map<number, { product_id: number; product_name: string; total_qty: number }>();

  for (const row of demandRows) {
    const hits = linkIndex.get(row.product_id);
    if (!hits || hits.length === 0) {
      const u = unmappedTotals.get(row.product_id);
      if (u) u.total_qty += row.qty;
      else unmappedTotals.set(row.product_id, { product_id: row.product_id, product_name: row.product_name, total_qty: row.qty });
      continue;
    }
    for (const hit of hits) {
      const key = `${hit.prep_item_id}|${row.sale_hour}`;
      const contribution = row.qty * hit.portions_per_sale;
      actualByKey.set(key, (actualByKey.get(key) || 0) + contribution);
    }
  }

  // 6. Build per-item, per-hour forecast buckets
  const forecastByKey = new Map<string, number>();
  for (const fr of forecastRows) {
    const key = `${fr.prep_item_id}|${fr.target_hour}`;
    forecastByKey.set(key, (forecastByKey.get(key) || 0) + fr.forecast_portions);
  }

  // 7. Assemble item variance rows
  const result: ItemVariance[] = [];
  for (const item of items) {
    const byHour: HourBucket[] = [];
    let totalForecast = 0;
    let totalActual = 0;
    for (let hour = 0; hour < 24; hour++) {
      const key = `${item.id}|${hour}`;
      const f = forecastByKey.get(key) || 0;
      const a = actualByKey.get(key) || 0;
      if (f === 0 && a === 0) continue;
      byHour.push({ hour, forecast: Math.round(f * 100) / 100, actual: Math.round(a * 100) / 100 });
      totalForecast += f;
      totalActual += a;
    }
    if (totalForecast === 0 && totalActual === 0) continue;
    const variance = totalActual - totalForecast;
    const variancePct = totalForecast > 0 ? Math.round((variance / totalForecast) * 1000) / 10 : null;
    result.push({
      prep_item_id: item.id,
      name: item.name,
      station: item.station,
      unit: item.unit,
      batch_size: item.batch_size,
      forecast: Math.round(totalForecast * 100) / 100,
      actual: Math.round(totalActual * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      variancePct,
      byHour,
    });
  }

  // Sort by absolute variance so the biggest misses surface first
  result.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const totalForecast = result.reduce((s, r) => s + r.forecast, 0);
  const totalActual = result.reduce((s, r) => s + r.actual, 0);
  const totalVar = totalActual - totalForecast;
  const totalVarPct = totalForecast > 0 ? Math.round((totalVar / totalForecast) * 1000) / 10 : null;

  return NextResponse.json({
    date,
    companyId,
    totals: {
      forecast: Math.round(totalForecast * 100) / 100,
      actual: Math.round(totalActual * 100) / 100,
      variance: Math.round(totalVar * 100) / 100,
      variancePct: totalVarPct,
      itemsWithData: result.length,
      itemsTotal: items.length,
    },
    items: result,
    unmappedProducts: Array.from(unmappedTotals.values()).sort((a, b) => b.total_qty - a.total_qty),
  });
}
