// src/app/api/rentals/payments/[id]/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Payment, Tenancy, PaymentStatus } from '@/types/rentals';

interface ResolveBody {
  action: 'accept_partial' | 'waive' | 'deduct_kaution' | 'carry_over';
  note?: string;
  user_id: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const body: ResolveBody = await req.json();
    const db = getRentalsDb();
    const now = berlinNow();

    const payment = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(id) as Payment | undefined;
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

    const tenancy = db.prepare(`SELECT * FROM tenancies WHERE id = ?`).get(payment.tenancy_id) as Tenancy;

    const tx = db.transaction(() => {
      let newStatus: PaymentStatus = payment.status as PaymentStatus;
      const shortfall = payment.shortfall;

      switch (body.action) {
        case 'accept_partial':
          newStatus = 'partial';
          break;
        case 'waive':
          newStatus = 'waived';
          break;
        case 'deduct_kaution': {
          if (tenancy.kaution_received < shortfall) {
            throw new Error(`Insufficient Kaution (${tenancy.kaution_received}) to cover shortfall (${shortfall})`);
          }
          db.prepare(`UPDATE tenancies SET kaution_received = kaution_received - ?, updated_at = ? WHERE id = ?`)
            .run(shortfall, now, tenancy.id);
          newStatus = 'deducted_from_kaution';
          break;
        }
        case 'carry_over': {
          // Find next month's expected payment and add shortfall to expected_amount
          const nextMonth = db.prepare(`
            SELECT * FROM payments WHERE tenancy_id = ? AND expected_date > ?
            ORDER BY expected_date ASC LIMIT 1
          `).get(tenancy.id, payment.expected_date) as Payment | undefined;

          if (nextMonth) {
            db.prepare(`UPDATE payments SET expected_amount = expected_amount + ?, updated_at = ? WHERE id = ?`)
              .run(shortfall, now, nextMonth.id);
          }
          newStatus = 'carried';
          break;
        }
      }

      db.prepare(`
        UPDATE payments
        SET status = ?, resolution_note = ?, resolved_by_user_id = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, body.note ?? null, body.user_id, now, now, id);
    });

    tx();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
