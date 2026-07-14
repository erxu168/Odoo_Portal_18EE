import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings — get all portal settings
 * Returns key-value pairs from portal_settings table
 */
export async function GET() {
  try {
    requireAuth();
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM portal_settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return NextResponse.json({ settings });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

/**
 * PUT /api/settings — update one or more settings
 * Body: { key: value, ... }
 */
export async function PUT(request: Request) {
  try {
    requireRole('admin');
    const db = getDb();
    const body = await request.json();

    const upsert = db.prepare(
      'INSERT INTO portal_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        upsert.run(key, String(value), now);
      }
    });
    tx();

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('PUT /api/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
