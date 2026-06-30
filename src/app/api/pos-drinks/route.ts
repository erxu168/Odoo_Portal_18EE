/**
 * What a Jerk — POS Drinks barcode entry API.
 *
 * Lets a manager scan a drink barcode and either attach it to an existing
 * What a Jerk POS product (most bottled drinks already exist without a
 * barcode) or create a brand-new sellable POS drink.
 *
 * GET  /api/pos-drinks?barcode=XXX   → look the barcode up across all products.
 *        Returns { found, product? } so the UI can warn about duplicates.
 * GET  /api/pos-drinks?q=NAME        → search existing WAJ POS drinks by name.
 *        Returns { results: [{ id, name, barcode, price }] } for match-or-attach.
 *
 * POST /api/pos-drinks   (manager+ only)
 *   { action: 'attach', product_id, barcode }       → set barcode on an existing product
 *   { action: 'create', barcode, name, list_price } → create a new sellable WAJ drink
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

// What a Jerk (Kottbusser Damm 96) — branch under Ssam Korean BBQ. Verified on
// staging 2026-06-30. NOTE: company 5 "What a Jerk" and 7 "WAJ ALT" are the old
// pre-migration leftovers — do NOT use them.
const WAJ_COMPANY_ID = 6;
const DRINKS_TAX_ID = 224;          // "19% MwSt. (incl.)" — every WAJ drink uses this
const WAJ_DRINKS_POS_CATEG = 195;   // POS category "WAJ Drinks"
const DRINKS_CATEG_ID = 28;         // internal product category "Drinks / Soft Drinks"

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const barcode = searchParams.get('barcode');
  const q = searchParams.get('q');

  try {
    const odoo = getOdoo();

    // Barcode lookup — does any product already carry this barcode?
    if (barcode) {
      const products = await odoo.searchRead(
        'product.product',
        [['barcode', '=', barcode]],
        ['id', 'name', 'company_id', 'available_in_pos'],
        { limit: 1, context: { active_test: false } },
      );
      if (products.length > 0) {
        const p = products[0];
        return NextResponse.json({
          found: true,
          product: {
            id: p.id,
            name: p.name,
            company: p.company_id ? p.company_id[1] : null,
            available_in_pos: p.available_in_pos,
          },
        });
      }
      return NextResponse.json({ found: false });
    }

    // Name search — existing What a Jerk POS drinks to attach a barcode to.
    if (q !== null) {
      const term = q.trim();
      const domain: any[] = [
        ['available_in_pos', '=', true],
        ['company_id', '=', WAJ_COMPANY_ID],
      ];
      if (term) domain.push(['name', 'ilike', term]);
      const results = await odoo.searchRead(
        'product.product',
        domain,
        ['id', 'name', 'barcode', 'lst_price'],
        { limit: 25, order: 'name', context: { active_test: false } },
      );
      return NextResponse.json({
        results: results.map((p) => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode || null,
          price: p.lst_price,
        })),
      });
    }

    return NextResponse.json({ error: 'Provide ?barcode= or ?q=' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[pos-drinks GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (user as any).role || 'staff';
  if (role === 'staff') {
    return NextResponse.json({ error: 'Only managers can add drinks' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const action = body.action;
    const barcode: string = (body.barcode ?? '').toString().trim();
    if (!barcode) return NextResponse.json({ error: 'barcode is required' }, { status: 400 });

    const odoo = getOdoo();

    // Guard: never let two products share a barcode (Odoo enforces it too, but
    // we want a friendly message instead of a raw SQL constraint error).
    const clash = await odoo.searchRead(
      'product.product',
      [['barcode', '=', barcode]],
      ['id', 'name'],
      { limit: 1, context: { active_test: false } },
    );
    if (clash.length > 0) {
      return NextResponse.json(
        { error: `Barcode already on "${clash[0].name}"` },
        { status: 409 },
      );
    }

    if (action === 'attach') {
      const productId = Number(body.product_id);
      if (!productId) return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
      await odoo.write('product.product', [productId], { barcode });
      const [p] = await odoo.read('product.product', [productId], ['id', 'name', 'lst_price']);
      return NextResponse.json({
        success: true,
        product: { id: p.id, name: p.name, price: p.lst_price, barcode },
      });
    }

    if (action === 'create') {
      const name: string = (body.name ?? '').toString().trim();
      const price = Number(body.list_price);
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: 'list_price must be a positive number' }, { status: 400 });
      }
      const templateId = await odoo.create('product.template', {
        name,
        barcode,
        list_price: price,
        type: 'consu',
        sale_ok: true,
        available_in_pos: true,
        company_id: WAJ_COMPANY_ID,
        categ_id: DRINKS_CATEG_ID,
        taxes_id: [[6, 0, [DRINKS_TAX_ID]]],
        pos_categ_ids: [[6, 0, [WAJ_DRINKS_POS_CATEG]]],
      });
      return NextResponse.json({
        success: true,
        product: { id: templateId, name, price, barcode },
      });
    }

    return NextResponse.json({ error: 'action must be "attach" or "create"' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[pos-drinks POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
