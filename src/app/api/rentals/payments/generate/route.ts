// src/app/api/rentals/payments/generate/route.ts
// Generates "expected" payment rows for the current month for all active tenancies.
// Run via cron on the 1st of each month, or on-demand from admin UI.
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow, berlinToday } from '@/lib/rentals-db';
import { Tenancy, TenancyRentStep } from '@/types/rentals';

export async function POST(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const now = berlinNow();
    const body = await req.json().catch(() => ({}));

    // Target month default = current
    const targetMonth: string = body.month || berlinToday().slice(0, 7);
    const firstOfMonth = `${targetMonth}-01`;

    // Load active tenancies
    const tenancies = db.prepare(`
      SELECT * FROM tenancies
      WHERE status = 'active'
        AND start_date <= ?
        AND (end_date IS NULL OR end_date >= ?)
    `).all(firstOfMonth, firstOfMonth) as Tenancy[];

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO payments
      (tenancy_id, expected_date, expected_amount, received_amount, status, shortfall, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'expected', 0, ?, ?)
    `);

    const applyStepStmt = db.prepare(`
      UPDATE tenancies SET kaltmiete = ?, warmmiete = ?, updated_at = ? WHERE id = ?
    `);
    const markStepApplied = db.prepare(`
      UPDATE tenancy_rent_steps SET applied = 1, applied_at = ? WHERE id = ?
    `);

    let created = 0;
    let stepsApplied = 0;

    const tx = db.transaction(() => {
      for (const t of tenancies) {
        // Apply any rent steps whose effective_date <= firstOfMonth and not yet applied
        const pendingSteps = db.prepare(`
          SELECT * FROM tenancy_rent_steps
          WHERE tenancy_id = ? AND applied = 0 AND effective_date <= ?
          ORDER BY effective_date ASC
        `).all(t.id, firstOfMonth) as TenancyRentStep[];

        let currentKalt = t.kaltmiete;
        for (const step of pendingSteps) {
          currentKalt = step.new_kaltmiete;
          const newWarm = currentKalt + t.nebenkosten;
          applyStepStmt.run(currentKalt, newWarm, now, t.id);
          markStepApplied.run(now, step.id);
          stepsApplied++;
        }
        const warmmiete = currentKalt + t.nebenkosten;

        const result = insertStmt.run(t.id, firstOfMonth, warmmiete, now, now);
        if (result.changes > 0) created++;
      }
    });

    tx();

    return NextResponse.json({ month: targetMonth, created, steps_applied: stepsApplied });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
