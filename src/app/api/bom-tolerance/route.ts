import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth, requireRole, AuthError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DEFAULT_TOLERANCE_KEY = 'default_tolerance_pct';
const DEFAULT_TOLERANCE_VALUE = 5; // 5% if nothing set

/**
 * GET /api/bom-tolerance?bom_id=X
 * Returns the effective tolerance for a BOM:
 *   1. Per-BOM override (if set)
 *   2. Global default from portal_settings
 *   3. Hardcoded 5% fallback
 */
export async function GET(request: Request) {
  try {
    requireAuth();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const bomId = searchParams.get('bom_id');

    // Get global default
    const globalRow = db.prepare('SELECT value FROM portal_settings WHERE key = ?').get(DEFAULT_TOLERANCE_KEY) as { value: string } | undefined;
    const globalDefault = globalRow ? parseFloat(globalRow.value) : DEFAULT_TOLERANCE_VALUE;

    if (bomId) {
      // Check per-BOM override
      const bomRow = db.prepare('SELECT tolerance_pct FROM bom_tolerance WHERE bom_id = ?').get(parseInt(bomId)) as { tolerance_pct: number } | undefined;

      return NextResponse.json({
        bom_id: parseInt(bomId),
        tolerance_pct: bomRow?.tolerance_pct ?? globalDefault,
        is_override: !!bomRow,
        global_default: globalDefault,
      });
    }

    // No bom_id — return all overrides + global default
    const overrides = db.prepare('SELECT bom_id, tolerance_pct, updated_at FROM bom_tolerance ORDER BY bom_id').all();
    return NextResponse.json({
      global_default: globalDefault,
      overrides,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('GET /api/bom-tolerance error:', error);
    return NextResponse.json({ error: 'Failed to fetch tolerance settings' }, { status: 500 });
  }
}

/**
 * PUT /api/bom-tolerance
 * Body: { bom_id: number, tolerance_pct: number }
 *   — sets per-BOM override
 * Body: { bom_id: number, tolerance_pct: null }
 *   — removes per-BOM override (reverts to global default)
 */
export async function PUT(request: Request) {
  try {
    requireRole('manager');
    const db = getDb();
    const body = await request.json();
    const bomId = body.bom_id;
    const tolerancePct = body.tolerance_pct;

    if (!bomId || typeof bomId !== 'number') {
      return NextResponse.json({ error: 'bom_id required' }, { status: 400 });
    }

    if (tolerancePct === null || tolerancePct === undefined) {
      // Remove override
      db.prepare('DELETE FROM bom_tolerance WHERE bom_id = ?').run(bomId);
      return NextResponse.json({ ok: true, action: 'removed' });
    }

    if (typeof tolerancePct !== 'number' || tolerancePct < 0 || tolerancePct > 100) {
      return NextResponse.json({ error: 'tolerance_pct must be 0-100' }, { status: 400 });
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO bom_tolerance (bom_id, tolerance_pct, updated_at) VALUES (?, ?, ?) ON CONFLICT(bom_id) DO UPDATE SET tolerance_pct = excluded.tolerance_pct, updated_at = excluded.updated_at'
    ).run(bomId, tolerancePct, now);

    return NextResponse.json({ ok: true, action: 'set', bom_id: bomId, tolerance_pct: tolerancePct });
  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('PUT /api/bom-tolerance error:', error);
    return NextResponse.json({ error: 'Failed to update tolerance settings' }, { status: 500 });
  }
}
