// src/app/api/rentals/rent-increase/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { analyzeRentIncrease } from '@/lib/mieterhoehung';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenancy_id, proposed_kaltmiete, proposed_effective_date } = body;

    if (!tenancy_id || proposed_kaltmiete === undefined || !proposed_effective_date) {
      return NextResponse.json(
        { error: 'tenancy_id, proposed_kaltmiete, proposed_effective_date required' },
        { status: 400 }
      );
    }

    const db = getRentalsDb();
    const now = berlinNow();

    // Re-run analysis for legal check snapshot
    const analysis = analyzeRentIncrease(tenancy_id);
    if (analysis.blockers.length > 0) {
      return NextResponse.json(
        { error: 'Legal blockers', blockers: analysis.blockers },
        { status: 400 }
      );
    }
    if (proposed_kaltmiete > analysis.max_kappung) {
      return NextResponse.json(
        { error: `Proposed rent exceeds Kappungsgrenze (max €${analysis.max_kappung})` },
        { status: 400 }
      );
    }
    if (analysis.max_mietpreisbremse && proposed_kaltmiete > analysis.max_mietpreisbremse) {
      return NextResponse.json(
        { error: `Proposed rent exceeds Mietpreisbremse (max €${analysis.max_mietpreisbremse})` },
        { status: 400 }
      );
    }

    const delta = proposed_kaltmiete - analysis.current_kaltmiete;
    const deltaPct = Math.round((delta / analysis.current_kaltmiete) * 1000) / 10;

    const result = db.prepare(`
      INSERT INTO rent_increases
      (tenancy_id, current_kaltmiete, proposed_kaltmiete, increase_pct,
       proposed_effective_date, legal_checks_json, mietspiegel_eur_per_sqm,
       status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      tenancy_id,
      analysis.current_kaltmiete,
      proposed_kaltmiete,
      deltaPct,
      proposed_effective_date,
      JSON.stringify(analysis.checks),
      analysis.mietspiegel_eur_per_sqm ?? 0,
      now,
      now
    );

    return NextResponse.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
