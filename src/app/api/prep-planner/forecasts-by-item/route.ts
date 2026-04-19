export const dynamic = 'force-dynamic';
/**
 * GET /api/prep-planner/forecasts-by-item?companyId=3&date=2026-04-20
 *   → latest successful-run prep-item-level forecasts for a company+date
 *
 * Shape:
 *   {
 *     forecasts: [
 *       {
 *         prep_item_id, prep_item_name, prep_item_unit,
 *         prep_item_station, prep_item_batch_size,
 *         target_date, target_hour, forecast_portions,
 *         source_products_json  // JSON string of breakdown for debug
 *       },
 *       ...
 *     ]
 *   }
 */
import { NextResponse } from 'next/server';
import { getLatestPrepItemForecasts } from '@/lib/prep-planner-mapping-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  const date = searchParams.get('date');
  if (!companyIdRaw || !date) {
    return NextResponse.json(
      { error: 'companyId and date (YYYY-MM-DD) are required' },
      { status: 400 },
    );
  }
  const companyId = parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId must be an integer' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  try {
    const forecasts = getLatestPrepItemForecasts(companyId, date);
    return NextResponse.json({ forecasts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
