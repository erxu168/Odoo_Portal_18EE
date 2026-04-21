export const dynamic = 'force-dynamic';
/**
 * POST /api/prep-planner/cook-plan/ack
 *
 * Body: { companyId, date, prep_item_id, action, planned_qty?, forecast_qty }
 * Upserts one prep_plan_acks row for the current user.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { upsertAck } from '@/lib/prep-plan-acks-db';

interface Body {
  companyId?: number;
  date?: string;
  prep_item_id?: number;
  action?: 'confirm' | 'adjust' | 'skip';
  planned_qty?: number | null;
  forecast_qty?: number;
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    companyId,
    date,
    prep_item_id,
    action,
    planned_qty,
    forecast_qty,
  } = body;

  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!Number.isFinite(prep_item_id)) {
    return NextResponse.json({ error: 'prep_item_id required' }, { status: 400 });
  }
  if (action !== 'confirm' && action !== 'adjust' && action !== 'skip') {
    return NextResponse.json({ error: 'action must be confirm|adjust|skip' }, { status: 400 });
  }
  if (!Number.isFinite(forecast_qty)) {
    return NextResponse.json({ error: 'forecast_qty required' }, { status: 400 });
  }

  let plannedQty: number | null = null;
  if (action === 'adjust') {
    if (!Number.isFinite(planned_qty) || (planned_qty as number) < 0) {
      return NextResponse.json({ error: 'planned_qty must be a non-negative number for adjust' }, { status: 400 });
    }
    plannedQty = planned_qty as number;
  } else if (action === 'confirm') {
    plannedQty = forecast_qty as number;
  } // skip -> null

  const ack = upsertAck({
    company_id: companyId as number,
    user_id: user.id,
    shift_date: date,
    prep_item_id: prep_item_id as number,
    action,
    planned_qty: plannedQty,
    forecast_qty: forecast_qty as number,
  });

  return NextResponse.json({ ok: true, ack });
}
