export const dynamic = 'force-dynamic';
/**
 * GET  /api/prep-planner/links?companyId=3
 *   → all active links for a company (flat list, joined with prep_item_name)
 *
 * POST /api/prep-planner/links
 *   body: { prep_item_id, pos_product_id, pos_product_name, portions_per_sale, notes? }
 *   → upsert a link. Conflict on (prep_item_id, pos_product_id) updates existing row.
 *
 * DELETE /api/prep-planner/links?id=123
 *   → remove a single link
 */
import { NextResponse } from 'next/server';
import {
  listAllLinksForCompany,
  upsertLink,
  deleteLink,
} from '@/lib/prep-planner-mapping-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyIdRaw = searchParams.get('companyId');
  if (!companyIdRaw) {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }
  const companyId = parseInt(companyIdRaw, 10);
  if (!Number.isFinite(companyId)) {
    return NextResponse.json({ error: 'companyId must be an integer' }, { status: 400 });
  }
  try {
    const links = listAllLinksForCompany(companyId);
    return NextResponse.json({ links });
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
  const prepItemId = typeof b.prep_item_id === 'number' ? b.prep_item_id : NaN;
  const posProductId = typeof b.pos_product_id === 'number' ? b.pos_product_id : NaN;
  const posProductName = typeof b.pos_product_name === 'string' ? b.pos_product_name.trim() : '';
  const portionsPerSale =
    typeof b.portions_per_sale === 'number' ? b.portions_per_sale : NaN;

  if (!Number.isFinite(prepItemId) || !Number.isFinite(posProductId) || !posProductName || !Number.isFinite(portionsPerSale)) {
    return NextResponse.json(
      { error: 'prep_item_id, pos_product_id, pos_product_name, and portions_per_sale are required' },
      { status: 400 },
    );
  }
  if (portionsPerSale <= 0) {
    return NextResponse.json({ error: 'portions_per_sale must be > 0' }, { status: 400 });
  }

  try {
    const id = upsertLink({
      prep_item_id: prepItemId,
      pos_product_id: posProductId,
      pos_product_name: posProductName,
      portions_per_sale: portionsPerSale,
      notes: typeof b.notes === 'string' ? b.notes : null,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get('id');
  if (!idRaw) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id must be an integer' }, { status: 400 });
  }
  try {
    deleteLink(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
