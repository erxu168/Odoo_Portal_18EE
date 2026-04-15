// src/app/api/rentals/utilities/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const row = db.prepare(`SELECT * FROM utility_providers WHERE id = ?`).get(Number(params.id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ utility: row });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const body = await req.json();
    const now = berlinNow();

    const fields = ['category', 'custom_label', 'provider_name', 'account_no', 'monthly_cost', 'frequency', 'due_date', 'notes'];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
    }
    if (updates.length === 0) return NextResponse.json({ updated: 0 });

    updates.push(`updated_at = ?`);
    values.push(now);
    values.push(id);

    const result = db.prepare(`UPDATE utility_providers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getRentalsDb();
    const result = db.prepare(`DELETE FROM utility_providers WHERE id = ?`).run(Number(params.id));
    return NextResponse.json({ deleted: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
