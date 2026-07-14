export const dynamic = 'force-dynamic';
/**
 * GET /api/inventory/products/similar?name=<draft name>&exclude_id=<draft id>
 *
 * Returns up to 10 existing ACTIVE non-POS products whose names share
 * any word (>= 3 chars) with the draft name. Used to warn managers
 * about probable duplicates before they approve a draft.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const name = (searchParams.get('name') || '').trim();
  const excludeId = parseInt(searchParams.get('exclude_id') || '0', 10);

  if (name.length < 2) return NextResponse.json({ matches: [] });

  // Tokenize: split on whitespace, keep words >= 3 chars, lowercase
  const tokens = name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);

  // If nothing long enough, fall back to the whole name
  const searchTokens = tokens.length > 0 ? tokens : [name.toLowerCase()];

  try {
    const odoo = getOdoo();
    // Build domain: (name ilike token1) OR (name ilike token2) ...
    // Odoo domain OR syntax: '|' prefixes two operands, so for N operands
    // we need (N-1) '|' prefixes.
    const domain: any[] = [
      ['type', '=', 'consu'],
      ['available_in_pos', '=', false],
      ['active', '=', true],
    ];
    if (excludeId) domain.push(['id', '!=', excludeId]);

    if (searchTokens.length === 1) {
      domain.push(['name', 'ilike', searchTokens[0]]);
    } else {
      for (let i = 0; i < searchTokens.length - 1; i++) domain.push('|');
      for (const tok of searchTokens) domain.push(['name', 'ilike', tok]);
    }

    const matches = await odoo.searchRead(
      'product.product',
      domain,
      ['id', 'name', 'categ_id', 'uom_id', 'barcode'],
      { limit: 10, order: 'name' },
    );

    return NextResponse.json({ matches });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/similar GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
