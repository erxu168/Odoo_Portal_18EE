// src/app/api/rentals/alerts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { moduleForbidden } from '@/lib/module-access';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = moduleForbidden('rentals');
  if (denied) return denied;

  try {
    const db = getRentalsDb();
    const id = Number(params.id);
    const body = await req.json();
    const now = berlinNow();

    const status = body.status;
    if (!['active', 'dismissed', 'resolved'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const result = db.prepare(`
      UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ?
    `).run(status, status === 'active' ? null : now, id);

    return NextResponse.json({ updated: result.changes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
