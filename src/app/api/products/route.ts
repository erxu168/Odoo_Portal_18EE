/**
 * POST /api/products — create a product in the catalog. Manager+.
 *
 * The ONE place the Products module creates a product. It asks for the four
 * things that cannot be guessed — name, category, unit, and whether stock is
 * tracked — and leaves everything else to be filled in on the product's own
 * page, which already owns those fields. A second form with the same fields
 * would be two places to fix a typo and two places for a bug to hide.
 *
 * is_storable is the field that makes this worth a route of its own. Odoo 18
 * asks "is this a physical good?" (type) and "do we track how much we hold?"
 * (is_storable) separately, and the second defaults to FALSE. Every earlier
 * creator here set only `type`, so products arrived holding no stock figure —
 * 133 of them, none of which could ever have taken a count.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, recordPortalCreatedProduct } from '@/lib/inventory-db';
import { invalidateRelevance } from '@/lib/relevance-cache';
import { buildProductVals } from '@/lib/product-create';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Same capability as the rest of catalog management. NOT
  // `inventory.product.create`, which is the all-roles scan-a-barcode path and
  // produces an inactive draft for review rather than a live product.
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  initInventoryTables();

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2) return NextResponse.json({ error: 'Give the product a name of at least 2 characters' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'Keep the name under 200 characters' }, { status: 400 });

  const uomId = Number(body.uom_id);
  if (!Number.isInteger(uomId) || uomId <= 0) {
    return NextResponse.json({ error: 'Pick the unit this is counted in' }, { status: 400 });
  }

  // Category is REQUIRED here even though Odoo would default it to "All".
  // Landing in "All" is how a product becomes invisible on every screen that
  // groups by category, and it is the state this module exists to prevent.
  const categId = Number(body.categ_id);
  if (!Number.isInteger(categId) || categId <= 0) {
    return NextResponse.json({ error: 'Pick a category so staff can find it' }, { status: 400 });
  }

  const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : '';
  if (barcode.length > 64) return NextResponse.json({ error: 'That barcode is too long' }, { status: 400 });
  const defaultCode = typeof body.default_code === 'string' ? body.default_code.trim() : '';
  if (defaultCode.length > 64) return NextResponse.json({ error: 'That internal reference is too long' }, { status: 400 });

  // Defaults to TRUE — the opposite of Odoo's default, deliberately. Anything
  // added from a stock catalog is something you hold and count unless the person
  // adding it says otherwise.
  const isStorable = body.is_storable === undefined ? true : body.is_storable === true;

  // A name collision is a WARNING the caller may override; a barcode collision
  // never is. Set once the caller has seen the warning and chosen to continue.
  const allowDuplicateName = body.allow_duplicate_name === true;

  try {
    const odoo = getOdoo();

    // --- barcode: a hard stop, and checked against ARCHIVED products too ----
    // Odoo enforces product barcode uniqueness in Python rather than with a
    // database constraint, and an archived product still holds its barcode. So
    // the scan that would find nothing today would find two things tomorrow if
    // the archived one came back. Checking here turns Odoo's eventual refusal
    // into a sentence that names the conflict.
    if (barcode) {
      const clash = await odoo.searchRead('product.product', [['barcode', '=', barcode]],
        ['id', 'name', 'active'], { limit: 1, context: { active_test: false } });
      if (clash.length > 0) {
        const c = clash[0] as { id: number; name: string; active: boolean };
        return NextResponse.json({
          error: c.active
            ? `That barcode is already on "${c.name}".`
            : `That barcode belongs to "${c.name}", which is archived. Bring that one back instead of making a second.`,
          code: 'BARCODE_TAKEN',
          existing_id: c.id,
        }, { status: 409 });
      }
    }

    // --- name: a warning, because two real products can share a name --------
    // "Chicken wings" bought from two suppliers is a legitimate pair. Refusing
    // outright — which this route used to do — leaves no way to record the
    // second one at all.
    if (!allowDuplicateName) {
      const same = await odoo.searchRead('product.product', [['name', '=ilike', name]],
        ['id', 'name', 'active', 'categ_id'], { limit: 1, context: { active_test: false } });
      if (same.length > 0) {
        const s = same[0] as { id: number; name: string; active: boolean; categ_id: [number, string] | false };
        return NextResponse.json({
          error: s.active
            ? `"${s.name}" already exists${Array.isArray(s.categ_id) ? ` in ${s.categ_id[1]}` : ''}.`
            : `"${s.name}" exists but is archived. Bring that one back rather than making a second.`,
          // Two codes, because they need two different answers: an active match
          // can be used as-is, an archived one has to be un-archived first. A
          // caller that treats every 409 as "just use existing_id" would
          // otherwise quietly attach a dead product to a live counting list.
          code: s.active ? 'NAME_EXISTS' : 'NAME_EXISTS_ARCHIVED',
          existing_id: s.id,
          existing_active: s.active,
        }, { status: 409 });
      }
    }

    // Shared with Purchase and the scan-a-barcode flow, so a field added for one
    // reaches all of them. Those three used to disagree, which is how every
    // product the portal has ever made ended up untracked in stock.
    const vals = buildProductVals({ name, uomId, categId, barcode, defaultCode, isStorable });

    const productId = await odoo.create('product.product', vals);

    // Both of these must happen even if the read-back below fails: the product
    // EXISTS now, and the catalog hides anything the restaurant does not yet use.
    try {
      recordPortalCreatedProduct(productId, user.id);
      invalidateRelevance();
    } catch (e) {
      console.error('[products POST] created', productId, 'but could not mark it visible:', e);
    }

    const created = await odoo.read('product.product', [productId],
      ['id', 'name', 'uom_id', 'categ_id', 'default_code', 'barcode', 'is_storable']);
    const c = created[0];
    if (!c) {
      // Created, but we cannot describe it. Reporting failure would have the
      // manager create it a second time.
      return NextResponse.json({
        product: { id: productId, name, uom_id: uomId, uom_name: '', categ_id: null,
          default_code: defaultCode || null, barcode: barcode || null, is_storable: isStorable },
        warning: 'Created, but reading it back failed — reopen it from the list if anything looks wrong.',
      }, { status: 201 });
    }

    return NextResponse.json({
      product: {
        id: c.id,
        name: c.name,
        // Back-compat: uom_id stays a scalar id (+ uom_name) as the original
        // contract. Existing callers in Purchase and the list builder rely on it.
        uom_id: Array.isArray(c.uom_id) ? c.uom_id[0] : null,
        uom_name: Array.isArray(c.uom_id) ? c.uom_id[1] : '',
        categ_id: c.categ_id || null,                               // [id, name] tuple
        default_code: c.default_code || null,
        barcode: c.barcode || null,
        is_storable: c.is_storable === true,
      },
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products POST]', message);
    // Odoo's own VALIDATION (a barcode that was taken in the moment between the
    // check above and the create, a category rule) is the manager's problem and
    // is shown verbatim so they learn why. Everything else — a timeout, a
    // refused login, the server being down — is ours, and must not be reported
    // as a 400: that tells monitoring the request was malformed and tells a
    // retry not to bother.
    const isValidation = /ValidationError|UserError|already (assigned|exists)|barcode|constraint/i.test(message);
    return NextResponse.json(
      { error: isValidation ? message : 'Could not reach Odoo to create the product. Try again.' },
      { status: isValidation ? 400 : 502 },
    );
  }
}
