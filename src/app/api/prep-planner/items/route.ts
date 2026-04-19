export const dynamic = 'force-dynamic';
/**
 * GET  /api/prep-planner/items?companyId=3[&includeInactive=1]
 *   → list prep items for a company
 *
 * POST /api/prep-planner/items
 *   body: { company_id, name, station?, prep_type?, prep_time_min?, max_holding_min?, batch_size?, unit?, location_id?, notes? }
 *   → create a new prep item, returns { id }
 *
 * Phase 2 admin endpoint. Manager/admin only — enforce upstream.
 */
import { NextResponse } from 'next/server';
import {
  listPrepItems,
  createPrepItem,
  type PrepItemInput,
} from '@/lib/prep-planner-mapping-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  const includeInactive = searchParams.get('includeInactive') === '1';
  if (!companyIdRaw) {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }
  const companyId = parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId must be an integer' }, { status: 400 });
  }
  try {
    const items = listPrepItems(companyId, { includeInactive });
    return NextResponse.json({ items });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const companyId = typeof b.company_id === 'number' ? b.company_id : parseInt(String(b.company_id ?? ''), 10);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!Number.isFinite(companyId) || !name) {
    return NextResponse.json({ error: 'company_id and name are required' }, { status: 400 });
  }
  const validPrepTypes = ['advance', 'batch', 'ondemand'] as const;
  const prepType = typeof b.prep_type === 'string' && (validPrepTypes as readonly string[]).includes(b.prep_type)
    ? (b.prep_type as 'advance' | 'batch' | 'ondemand')
    : null;
  try {
    const input: PrepItemInput = {
      company_id: companyId,
      name,
      location_id: typeof b.location_id === 'number' ? b.location_id : null,
      station: typeof b.station === 'string' ? b.station : null,
      prep_type: prepType,
      prep_time_min: typeof b.prep_time_min === 'number' ? b.prep_time_min : null,
      max_holding_min: typeof b.max_holding_min === 'number' ? b.max_holding_min : null,
      batch_size: typeof b.batch_size === 'number' ? b.batch_size : null,
      unit: typeof b.unit === 'string' ? b.unit : 'portion',
      notes: typeof b.notes === 'string' ? b.notes : null,
    };
    const id = createPrepItem(input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // UNIQUE(company_id, name) violation → 409 Conflict
    const status = /UNIQUE constraint failed/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
