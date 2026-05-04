import { NextResponse } from 'next/server';
import { requireRole, AuthError } from '@/lib/auth';
import { spawnTodayLists } from '@/lib/odoo-tasks';

export async function POST() {
  try {
    requireRole('manager');
    await spawnTodayLists();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to spawn lists';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
