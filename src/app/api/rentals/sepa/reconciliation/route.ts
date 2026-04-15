// src/app/api/rentals/sepa/reconciliation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb } from '@/lib/rentals-db';

export async function GET(req: NextRequest) {
  try {
    const db = getRentalsDb();
    const importId = req.nextUrl.searchParams.get('import_id');
    const month = req.nextUrl.searchParams.get('month'); // YYYY-MM

    // Load import header
    let importHeader = null;
    if (importId) {
      importHeader = db.prepare(`SELECT * FROM sepa_imports WHERE id = ?`).get(Number(importId));
    } else {
      importHeader = db.prepare(`SELECT * FROM sepa_imports ORDER BY imported_at DESC LIMIT 1`).get();
    }

    // Payments for the month (default current)
    const targetMonth = month || new Date().toISOString().slice(0, 7);

    const payments = db.prepare(`
      SELECT p.*,
        tn.full_name AS tenant_name,
        r.room_code, r.room_name,
        prop.street, prop.plz, prop.city,
        st.counterparty_iban AS matched_iban,
        st.tx_date AS matched_tx_date
      FROM payments p
      JOIN tenancies t ON t.id = p.tenancy_id
      JOIN tenants tn ON tn.id = t.tenant_id
      JOIN rooms r ON r.id = t.room_id
      JOIN properties prop ON prop.id = r.property_id
      LEFT JOIN sepa_transactions st ON st.id = p.sepa_tx_id
      WHERE substr(p.expected_date, 1, 7) = ?
      ORDER BY p.status, tn.full_name
    `).all(targetMonth);

    // Unmatched transactions (for manual assignment pool)
    const unmatchedTx = db.prepare(`
      SELECT * FROM sepa_transactions WHERE status = 'unmatched'
      ORDER BY tx_date DESC LIMIT 50
    `).all();

    // Counts
    const counts = payments.reduce<{ matched: number; partial: number; missing: number }>(
      (acc, p) => {
        const status = (p as { status: string }).status;
        if (status === 'matched') acc.matched++;
        else if (status === 'partial') acc.partial++;
        else if (status === 'missing' || status === 'expected') acc.missing++;
        return acc;
      },
      { matched: 0, partial: 0, missing: 0 }
    );

    return NextResponse.json({
      import: importHeader,
      month: targetMonth,
      counts,
      payments,
      unmatched_tx: unmatchedTx,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
