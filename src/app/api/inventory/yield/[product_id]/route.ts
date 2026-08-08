export const dynamic = 'force-dynamic';
/**
 * /api/inventory/yield/[product_id] — a product's yield tests.
 *
 *   GET     list them, with the rolled-up summary
 *   POST    record one (raw weight, pieces, usable weight)
 *   DELETE  ?test_id=N — remove one this restaurant recorded
 *
 * The summary is computed HERE rather than in the browser so the number a
 * manager reads is the same number a future costing report would use; two
 * implementations of the same average is exactly how they drift apart.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { userCompanyAllowed } from '@/lib/company-scope';
import { moduleForbidden } from '@/lib/module-access';
import {
  initInventoryTables, getYieldTests, addYieldTest, deleteYieldTest,
  type YieldTestRow,
} from '@/lib/inventory-db';
import { summarise, validate, normalisePieces, eligibility, type YieldTest } from '@/lib/yield';
import { indexSupplierPrices, resolveBuyPrice, type ResolvedPrice } from '@/lib/purchase-price';
import { getOdoo } from '@/lib/odoo';

function activeCompany(url: URL): number {
  return parseInt(url.searchParams.get('company_id') || '0', 10)
    || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
}

const asTest = (r: YieldTestRow): YieldTest => ({ ...r });

function productIdFrom(params: { product_id: string }): number | null {
  const id = parseInt(params.product_id, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * WHAT WE PAY for this product — supplier price first, our own cost second.
 *
 * NOT `standard_price` alone, which is what this route reached for at first:
 * across this catalogue 515 of 601 products carry a supplier price and only 8
 * carry a cost, so a true cost built on `standard_price` would have been blank
 * on essentially every product it was written for. Same resolver the order
 * guide uses, so the two screens cannot quote different prices for one product.
 * (Codex, 2026-08-08.)
 *
 * Best-effort: Odoo being unreachable costs the true-cost line, not the yield.
 */
async function buyPrice(productId: number): Promise<ResolvedPrice | null> {
  try {
    const odoo = getOdoo();
    const rows = await odoo.searchRead('product.product', [['id', '=', productId]],
      ['id', 'standard_price', 'product_tmpl_id'], { limit: 1 });
    const product = (rows as { id: number; standard_price?: number; product_tmpl_id?: [number, string] }[])[0];
    if (!product) return null;
    const tmplId = Array.isArray(product.product_tmpl_id) ? product.product_tmpl_id[0] : null;
    // A supplierinfo row hangs off the variant OR the template — ask for both,
    // or most prices are missed (the order guide learned this the hard way).
    const sellers = await odoo.searchRead('product.supplierinfo',
      tmplId != null
        ? ['|', ['product_id', '=', productId], ['product_tmpl_id', '=', tmplId]]
        : [['product_id', '=', productId]],
      ['product_id', 'product_tmpl_id', 'partner_id', 'price', 'min_qty'], { limit: 50 });
    return resolveBuyPrice(product, indexSupplierPrices(sellers as never[]));
  } catch (err: unknown) {
    console.warn('[yield] price lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** The product's base unit, straight from Odoo. Null when Odoo cannot be asked. */
async function productUom(productId: number): Promise<string | null> {
  try {
    const rows = await getOdoo().searchRead('product.product', [['id', '=', productId]], ['uom_id'], { limit: 1 });
    const u = (rows as { uom_id?: [number, string] }[])[0]?.uom_id;
    // A product that does not exist has no unit, and '' fails eligibility —
    // which is the right answer for "record a test against product 99999".
    return Array.isArray(u) ? u[1] : '';
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: { product_id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const productId = productIdFrom(params);
  if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  try {
    initInventoryTables();
    const tests = getYieldTests(productId);
    const price = await buyPrice(productId);
    // WHO IS ASKING is answered here, not by the caller. ProductDetail is
    // mounted from three screens and only one of them knows the user's
    // capabilities; the other two would have had to guess from "can this person
    // edit the product", which is a different question. (Codex, 2026-08-08.)
    const canRecord = roleCan(user.role, 'inventory.yield.record', getPermissionOverrides());
    return NextResponse.json({ tests, summary: summarise(tests.map(asTest)), price, can_record: canRecord });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[yield GET]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { product_id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.yield.record', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Not allowed to record yield tests' }, { status: 403 });
  }

  const productId = productIdFrom(params);
  if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  const url = new URL(request.url);
  const company = activeCompany(url);
  // Fail CLOSED: a test with no restaurant on it can never be deleted by
  // anyone (the delete is company-matched), and it would still move a shared
  // average. No company, no write.
  if (!company || !userCompanyAllowed(user, company)) {
    return NextResponse.json({ error: 'No access to this restaurant' }, { status: 403 });
  }

  try {
    const body = await request.json();
    // STRICT. `Number(null)` is 0, so a body with `usable_qty: null` used to
    // sail through validation as a genuine "nothing was usable" measurement and
    // drag the pooled average to zero. A missing weight is a bad request, not a
    // reading of zero. (Codex, 2026-08-08.)
    const strict = (v: unknown): number | null => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    const raw_qty = strict(body.raw_qty);
    const usable_qty = strict(body.usable_qty);
    if (raw_qty == null || usable_qty == null) {
      return NextResponse.json({ error: 'Both weights are required.' }, { status: 400 });
    }
    // Blank means "nobody counted". NONSENSE does not: `strict('abc')` is null
    // too, and treating the two the same silently dropped a typo'd piece count
    // and saved the test without it. (Codex, 2026-08-08.)
    let pieces: number | null = null;
    if (body.pieces != null && body.pieces !== '') {
      pieces = strict(body.pieces);
      if (pieces == null) {
        return NextResponse.json({ error: 'Pieces must be a number, or left empty.' }, { status: 400 });
      }
    }

    const bad = validate({ raw_qty, usable_qty, pieces });
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    // THE UNIT DECIDES whether this product can have a yield test at all, and
    // the browser is not allowed to answer that. The screen can be showing a
    // stale unit (ProductDetail is reused across products without a key, so a
    // switch from a kg product to a Units one can leave the old unit in its
    // props), and a direct request answers nothing at all. Checked here, once,
    // on an action a kitchen performs a few times a week. (Codex, 2026-08-08.)
    const uom = await productUom(productId);
    if (uom == null) {
      return NextResponse.json(
        { error: 'Could not reach Odoo to check this product. Nothing was saved.' },
        { status: 503 },
      );
    }
    const elig = eligibility(uom);
    if (!elig.canTest) return NextResponse.json({ error: elig.reason }, { status: 400 });

    initInventoryTables();
    const note = typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 300) : null;
    // Namespaced by product so a client that reuses a key across two products
    // cannot have the second save silently return the first product's test.
    const clientKey = typeof body.client_key === 'string' && body.client_key.trim()
      ? `${productId}:${body.client_key.trim().slice(0, 80)}` : null;
    // Return the row itself, not just the new list: a caller that has to undo
    // its own write must know WHICH row is its own, and diffing two list
    // snapshots to work that out fails exactly when it matters.
    const created = addYieldTest({
      productId, companyId: company, rawQty: raw_qty,
      pieces: normalisePieces(pieces), usableQty: usable_qty, note, userId: user.id,
      clientKey,
    });

    const tests = getYieldTests(productId);
    return NextResponse.json({ success: true, test: created, tests, summary: summarise(tests.map(asTest)) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[yield POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { product_id: string } }) {
  const denied = moduleForbidden('inventory');
  if (denied) return denied;
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.yield.record', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Not allowed to change yield tests' }, { status: 403 });
  }

  const productId = productIdFrom(params);
  if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  const url = new URL(request.url);
  const testId = parseInt(url.searchParams.get('test_id') || '0', 10);
  if (!testId) return NextResponse.json({ error: 'Which test?' }, { status: 400 });

  const company = activeCompany(url);
  if (!company || !userCompanyAllowed(user, company)) {
    return NextResponse.json({ error: 'No access to this restaurant' }, { status: 403 });
  }

  try {
    initInventoryTables();
    if (!deleteYieldTest(testId, company, productId)) {
      return NextResponse.json(
        { error: 'That test is not this restaurant\'s to remove, or it is already gone.' },
        { status: 404 },
      );
    }
    const tests = getYieldTests(productId);
    return NextResponse.json({ success: true, tests, summary: summarise(tests.map(asTest)) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[yield DELETE]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
