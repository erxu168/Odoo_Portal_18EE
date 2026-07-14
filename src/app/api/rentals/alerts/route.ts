// src/app/api/rentals/alerts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb } from '@/lib/rentals-db';
import { runAlertsEngine } from '@/lib/alerts-engine';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const status = req.nextUrl.searchParams.get('status') || 'active';
    const rows = db.prepare(`
      SELECT * FROM alerts WHERE status = ?
      ORDER BY
        CASE type
          WHEN 'contract_ending_30' THEN 1
          WHEN 'payment_overdue' THEN 2
          WHEN 'contract_ending_60' THEN 3
          WHEN 'staffel_step_due' THEN 4
          WHEN 'rent_increase_eligible' THEN 5
          WHEN 'contract_ending_90' THEN 6
          ELSE 9
        END,
        due_date
    `).all(status);
    return NextResponse.json({ alerts: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  // Manually trigger the alerts engine (also used by cron)
  try {
    const result = runAlertsEngine();
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
