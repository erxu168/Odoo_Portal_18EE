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
 * GET  /api/pos-drinks?options=1     → dropdown choices for the drink editor.
 *        Returns { categories, taxes, uoms } (till sections, sale taxes, units).
 * GET  /api/pos-drinks?detail=ID     → current editable fields of one drink.
 *        Returns { product: { id, name, price, uom_id, tax_id, pos_categ_id } }.
 *
 * POST /api/pos-drinks   (manager+ only)
 *   { action: 'attach', product_id, barcode }       → set barcode on an existing product
 *   { action: 'create', barcode, name, list_price } → create a new sellable WAJ drink
 *   { action: 'update', product_id, name, list_price, uom_id, tax_id, pos_categ_id }
 *                                                    → edit an existing drink's details
 *   { action: 'delete', product_id }                → archive a drink (hide from till)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

// What a Jerk (Kottbusser Damm 96) — branch under Ssam Korean BBQ. Verified on
// staging 2026-06-30. NOTE: company 5 "What a Jerk" and 7 "WAJ ALT" are the old
// pre-migration leftovers — do NOT use them.
const WAJ_COMPANY_ID = 6;
const DRINKS_TAX_ID = 224;          // "19% MwSt. (incl.)" — every WAJ drink uses this
const WAJ_DRINKS_POS_CATEG = 195;   // POS category "WAJ Drinks"
const DRINKS_CATEG_ID = 28;         // internal product category "Drinks / Soft Drinks"
const WAJ_POS_CATEGS = [193, 194, 195, 196]; // WAJ Grill / Sides / Drinks / Wraps — the till sections
const WAJ_FOOD_POS_CATEGS = [193, 194, 196]; // Grill / Sides / Wraps — everything that ISN'T a drink
const UOM_CATEGORIES = ['Unit', 'Volume']; // sensible units to offer for a drink

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const barcode = searchParams.get('barcode');
  const q = searchParams.get('q');
  const options = searchParams.get('options');
  const detail = searchParams.get('detail');
  const drinksOnly = searchParams.get('drinks_only');

  try {
    const odoo = getOdoo();

    // Dropdown choices for the editor: till sections, sale taxes, units.
    if (options) {
      const [cats, taxes, uoms] = await Promise.all([
        odoo.searchRead('pos.category', [['id', 'in', WAJ_POS_CATEGS]], ['id', 'name'], { order: 'name' }),
        odoo.searchRead(
          'account.tax',
          [['type_tax_use', '=', 'sale'], ['company_id', '=', WAJ_COMPANY_ID]],
          ['id', 'name', 'amount'],
          { order: 'amount desc', limit: 50 },
        ),
        odoo.searchRead('uom.uom', [], ['id', 'name', 'category_id'], { limit: 200 }),
      ]);
      return NextResponse.json({
        categories: cats.map((c) => ({ id: c.id, name: c.name })),
        taxes: taxes.map((t) => ({ id: t.id, name: t.name, amount: t.amount })),
        uoms: uoms
          .filter((u) => Array.isArray(u.category_id) && UOM_CATEGORIES.includes(u.category_id[1]))
          .map((u) => ({ id: u.id, name: u.name, category: u.category_id[1] })),
      });
    }

    // Current editable values of a single drink, to pre-fill the edit form.
    if (detail) {
      const id = Number(detail);
      const [p] = await odoo.read(
        'product.product', [id],
        ['id', 'name', 'lst_price', 'uom_id', 'taxes_id', 'pos_categ_ids'],
      );
      if (!p) return NextResponse.json({ error: 'Drink not found' }, { status: 404 });
      return NextResponse.json({
        product: {
          id: p.id,
          name: p.name,
          price: p.lst_price,
          uom_id: Array.isArray(p.uom_id) ? p.uom_id[0] : null,
          tax_id: Array.isArray(p.taxes_id) && p.taxes_id.length ? p.taxes_id[0] : null,
          pos_categ_id: Array.isArray(p.pos_categ_ids) && p.pos_categ_ids.length ? p.pos_categ_ids[0] : null,
        },
      });
    }

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
      // Editor passes drinks_only=1 so food (Grill/Sides/Wraps) is left out —
      // drinks are anything NOT filed under a food section (incl. untagged bottles).
      if (drinksOnly) domain.push(['pos_categ_ids', 'not in', WAJ_FOOD_POS_CATEGS]);
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

  // Capability-gated (default manager+admin, admin-adjustable) — matches the
  // dashboard tile + screen gate so an override works end-to-end, not UI-only.
  if (!roleCan((user as any).role || 'staff', 'inventory.drinks.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Only managers can add drinks' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const action = body.action;
    const odoo = getOdoo();

    // Edit an existing drink's details. No barcode involved, so this runs
    // before the barcode guard below.
    if (action === 'update') {
      const productId = Number(body.product_id);
      if (!productId) return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
      const name: string = (body.name ?? '').toString().trim();
      const price = Number(body.list_price);
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: 'Price must be a positive number' }, { status: 400 });
      }
      const [prod] = await odoo.read('product.product', [productId], ['product_tmpl_id']);
      if (!prod?.product_tmpl_id) return NextResponse.json({ error: 'Drink not found' }, { status: 404 });

      const vals: Record<string, unknown> = { name, list_price: price };
      const uomId = Number(body.uom_id);
      if (Number.isFinite(uomId) && uomId > 0) { vals.uom_id = uomId; vals.uom_po_id = uomId; }
      const taxId = Number(body.tax_id);
      if (Number.isFinite(taxId) && taxId > 0) vals.taxes_id = [[6, 0, [taxId]]];
      const posCategId = Number(body.pos_categ_id);
      if (Number.isFinite(posCategId) && posCategId > 0) vals.pos_categ_ids = [[6, 0, [posCategId]]];

      await odoo.write('product.template', [prod.product_tmpl_id[0]], vals);
      return NextResponse.json({ success: true, product: { id: productId, name, price } });
    }

    // Remove a drink from the till. We ARCHIVE (active=false) rather than hard
    // delete: Odoo blocks unlink for any product that's been sold, and archiving
    // is reversible (un-archive in Odoo) while still hiding it everywhere.
    if (action === 'delete') {
      const productId = Number(body.product_id);
      if (!productId) return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
      const [prod] = await odoo.read('product.product', [productId], ['product_tmpl_id', 'name']);
      if (!prod?.product_tmpl_id) return NextResponse.json({ error: 'Drink not found' }, { status: 404 });
      await odoo.write('product.template', [prod.product_tmpl_id[0]], { active: false });
      return NextResponse.json({ success: true, product: { id: productId, name: prod.name } });
    }

    // attach/create both work off a scanned barcode.
    const barcode: string = (body.barcode ?? '').toString().trim();
    if (!barcode) return NextResponse.json({ error: 'barcode is required' }, { status: 400 });

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
      const [p] = await odoo.read('product.product', [productId], ['id', 'name', 'lst_price', 'product_tmpl_id']);
      // Also file the drink under "WAJ Drinks" so it's tappable at the till as a
      // fallback when a barcode is damaged. [4, id] adds the category without
      // touching any it already has, and is a no-op if already present.
      if (p.product_tmpl_id) {
        await odoo.write('product.template', [p.product_tmpl_id[0]], {
          pos_categ_ids: [[4, WAJ_DRINKS_POS_CATEG]],
        });
      }
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

    return NextResponse.json({ error: 'action must be "attach", "create" or "update"' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[pos-drinks POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
