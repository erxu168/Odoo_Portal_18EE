import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { getListById } from '@/lib/odoo-tasks';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const list = await getListById(id);
    if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });
    return NextResponse.json({ list });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to load list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
