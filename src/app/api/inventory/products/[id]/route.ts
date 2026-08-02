export const dynamic = 'force-dynamic';
/**
 * Product master data (portal ↔ Odoo). Manager+ (product settings).
 *
 * GET  /api/inventory/products/[id] — read the editable master fields (name,
 *      internal reference, barcode, category, unit, sales price, cost, taxes).
 * PUT  /api/inventory/products/[id] — write any subset of them back to Odoo.
 *      Odoo can refuse a change (e.g. a UoM category change on a used product);
 *      that error is surfaced verbatim as a 400, never swallowed.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, logAudit, parseCompanyIds } from '@/lib/db';

import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, describeCountWorkForProduct, deleteProductPortalData, isDraftProduct, describeProductUsage } from '@/lib/inventory-db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { taxDiffCommands } from '@/lib/product-tax';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }
  const productId = parseInt(params.id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }
  try {
    const odoo = getOdoo();
    const rows = await odoo.searchRead('product.product', [['id', '=', productId]],
      ['id', 'name', 'default_code', 'barcode', 'categ_id', 'uom_id', 'list_price', 'standard_price',
        // Both tax lists, raw. Which entry belongs to the active restaurant is
        // decided in the client against that restaurant's tax ids — the server
        // cannot pick without being told which restaurant is asking, and
        // guessing "the first one" reads another company's rate as yours.
        'taxes_id', 'supplier_taxes_id',
        // Odoo 18 asks "is it a physical good?" (type) and "do we track how much
        // we hold?" (is_storable) separately, and the second defaults to FALSE.
        // Off means no stock figure exists, so an approved count cannot be
        // written back — the single most consequential field on this screen.
        'is_storable', 'type',
        'description'],
      { limit: 1, context: { active_test: false } });
    if (rows.length === 0) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ product: rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products GET]', msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const body = await request.json();
  const vals: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    if (name.length > 200) return NextResponse.json({ error: 'Keep the name under 200 characters' }, { status: 400 });
    vals.name = name;
  }
  if (body.uom_id !== undefined) {
    const uomId = Number(body.uom_id);
    if (!Number.isInteger(uomId) || uomId <= 0) {
      return NextResponse.json({ error: 'Invalid unit of measure' }, { status: 400 });
    }
    vals.uom_id = uomId;
    // uom_po_id (purchase unit) is set below ONLY when the unit family changes —
    // a same-family change must not destroy e.g. "stock in Units, buy in boxes".
  }
  if (body.categ_id !== undefined) {
    const catId = Number(body.categ_id);
    if (!Number.isInteger(catId) || catId <= 0) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    vals.categ_id = catId;
  }
  if (body.barcode !== undefined) {
    const bc = String(body.barcode).trim();
    if (bc.length > 64) return NextResponse.json({ error: 'Barcode too long' }, { status: 400 });
    vals.barcode = bc === '' ? false : bc;   // Odoo: false clears the barcode
  }
  if (body.default_code !== undefined) {
    const code = String(body.default_code).trim();
    if (code.length > 64) return NextResponse.json({ error: 'Internal reference too long' }, { status: 400 });
    vals.default_code = code === '' ? false : code;   // Odoo: false clears it
  }
  if (body.list_price !== undefined) {
    const price = Number(body.list_price);
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: 'Sales price must be a number of 0 or more' }, { status: 400 });
    vals.list_price = price;
  }
  if (body.standard_price !== undefined) {
    const cost = Number(body.standard_price);
    if (!Number.isFinite(cost) || cost < 0) return NextResponse.json({ error: 'Cost must be a number of 0 or more' }, { status: 400 });
    vals.standard_price = cost;
  }
  if (body.description !== undefined) {
    // Odoo's own note field on the product, so a note typed here is the note an
    // Odoo user reads — rather than a second place the same thing can live.
    const note = String(body.description);
    if (note.length > 5000) return NextResponse.json({ error: 'Note is too long' }, { status: 400 });
    vals.description = note.trim() === '' ? false : note;
  }
  if (body.is_storable !== undefined) {
    if (typeof body.is_storable !== 'boolean') {
      return NextResponse.json({ error: 'is_storable must be true or false' }, { status: 400 });
    }
    // Odoo 18's "Track Inventory". Off means the product holds no stock figure,
    // so a count of it can never be written back. Odoo itself may refuse to turn
    // it OFF once stock moves exist; that refusal is surfaced verbatim below
    // rather than swallowed, because "it didn't save and nobody said why" is the
    // worse outcome.
    vals.is_storable = body.is_storable;
  }

  // --- taxes ------------------------------------------------------------
  // Per restaurant, on a record shared by all of them. Handled inside the try
  // below because it needs the product's CURRENT tax lists to merge against.
  const wantsSaleTax = body.sale_tax_id !== undefined;
  const wantsPurchaseTax = body.purchase_tax_id !== undefined;
  const taxCompanyRaw = body.company_id;
  if (wantsSaleTax || wantsPurchaseTax) {
    const companyId = Number(taxCompanyRaw);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ error: 'A restaurant is required to set tax' }, { status: 400 });
    }
    // A tax change is a change to ONE restaurant's accounting on a shared
    // record, so the caller must be entitled to that restaurant. PUT had no
    // company check at all before this; adding one is required by the field
    // being added, not optional hardening.
    if (!isUnrestrictedAdmin(user) && !canAccessCompany(user, companyId)) {
      return NextResponse.json({ error: 'That restaurant is not yours' }, { status: 403 });
    }
  }

  if (Object.keys(vals).length === 0 && !wantsSaleTax && !wantsPurchaseTax) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    // Product must exist (drafts included — active_test off). company_id is read
    // so the guard below can run: PUT previously read only `id`, which meant a
    // manager scoped to one restaurant could rename, reprice or reconfigure
    // another restaurant's private product by putting its id in the URL.
    const rows = await odoo.searchRead('product.product', [['id', '=', productId]],
      ['id', 'company_id', 'taxes_id', 'supplier_taxes_id'],
      { limit: 1, context: { active_test: false } });
    if (rows.length === 0) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const current = rows[0] as { company_id: [number, string] | false; taxes_id: number[]; supplier_taxes_id: number[] };

    // Most products here are shared (company_id = false) and genuinely belong to
    // everyone. A product TAGGED to one restaurant is that restaurant's.
    const owner = Array.isArray(current.company_id) ? current.company_id[0] : null;
    if (owner != null && !isUnrestrictedAdmin(user) && !canAccessCompany(user, owner)) {
      return NextResponse.json({
        error: `This product belongs to ${Array.isArray(current.company_id) ? current.company_id[1] : 'another restaurant'}. Ask someone there to change it.`,
        code: 'WRONG_COMPANY',
      }, { status: 403 });
    }

    if (wantsSaleTax || wantsPurchaseTax) {
      const companyId = Number(taxCompanyRaw);
      // OWNERSHIP is resolved from the taxes actually ON THE PRODUCT, by looking
      // up those exact ids — not by listing the restaurant's taxes and hoping the
      // product's are among them.
      //
      // Listing was wrong three ways at once. It capped at 200 rows; it filtered
      // by type_tax_use, so a tax since retyped looked like nobody's; and it
      // excluded inactive taxes (Odoo drops them unless active_test is off),
      // which matters because 92 products here still carry a WAJ sales tax that
      // has since been archived. Any of those made a tax of THIS restaurant look
      // like another's, so the write preserved it and left the product holding
      // two of this restaurant's taxes at once.
      const onProduct = Array.from(new Set([...(current.taxes_id || []), ...(current.supplier_taxes_id || [])]));
      const [taxOwners, chosenRows] = await Promise.all([
        onProduct.length > 0
          ? odoo.searchRead('account.tax', [['id', 'in', onProduct]], ['id', 'company_id'],
              { limit: onProduct.length, context: { active_test: false } })
          : Promise.resolve([]),
        // The chosen ids, validated on their own terms: a tax may be DISPLACED
        // after being retired, but never newly CHOSEN.
        (() => {
          const want = [body.sale_tax_id, body.purchase_tax_id]
            .map((v) => (v === '' || v == null ? null : Number(v)))
            .filter((v): v is number => v != null && Number.isInteger(v) && v > 0);
          return want.length > 0
            ? odoo.searchRead('account.tax', [['id', 'in', want]],
                ['id', 'company_id', 'type_tax_use', 'active'], { limit: want.length })
            : Promise.resolve([]);
        })(),
      ]);

      const ownedByCompany = new Set(
        (taxOwners as { id: number; company_id: [number, string] | false }[])
          .filter((t) => (Array.isArray(t.company_id) ? t.company_id[0] : null) === companyId)
          .map((t) => t.id),
      );

      const apply = (field: 'taxes_id' | 'supplier_taxes_id', use: 'sale' | 'purchase', raw: unknown) => {
        // '' and null both mean "no tax for this restaurant". 0 is not a tax id.
        const chosen = raw === '' || raw == null ? null : Number(raw);
        if (chosen != null && (!Number.isInteger(chosen) || chosen <= 0)) {
          throw new Error('TAX_INVALID: that is not a tax');
        }
        if (chosen != null) {
          const row = (chosenRows as { id: number; company_id: [number, string] | false; type_tax_use: string; active: boolean }[])
            .find((t) => t.id === chosen);
          // searchRead applies active_test, so a retired tax simply is not here.
          if (!row) throw new Error('TAX_INVALID: that tax is retired or does not exist');
          if ((Array.isArray(row.company_id) ? row.company_id[0] : null) !== companyId) {
            throw new Error('TAX_NOT_IN_COMPANY: that tax belongs to a different restaurant');
          }
          if (row.type_tax_use !== use) {
            throw new Error(`TAX_INVALID: that is a ${row.type_tax_use} tax, not a ${use} tax`);
          }
          // A chosen tax is by definition this restaurant's, so it joins the
          // displaceable set even when the product does not carry it yet.
          ownedByCompany.add(chosen);
        }
        const cmds = taxDiffCommands(
          ((current as unknown as Record<string, number[]>)[field] || []),
          Array.from(ownedByCompany),
          chosen,
        );
        // No commands = the product already has exactly this. Writing nothing is
        // better than writing a no-op that still bumps the record.
        if (cmds.length > 0) vals[field] = cmds;
      };

      try {
        if (wantsSaleTax) apply('taxes_id', 'sale', body.sale_tax_id);
        if (wantsPurchaseTax) apply('supplier_taxes_id', 'purchase', body.purchase_tax_id);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : 'Tax could not be set';
        if (m.startsWith('TAX_NOT_IN_COMPANY') || m.startsWith('TAX_INVALID')) {
          return NextResponse.json({ error: m.replace(/^[A-Z_]+: /, '') }, { status: 400 });
        }
        throw e;
      }
      // KNOWN LIMIT, stated rather than papered over. Two managers at the SAME
      // restaurant saving different taxes on the same product within the same
      // second each write "unlink the old one, link mine", and both links land —
      // leaving that restaurant holding two taxes.
      //
      // A post-write read-back-and-tidy was tried and REMOVED: both requests
      // tidy too, each unlinking what it sees as the other's stray, and the
      // product can end up with NO tax for the restaurant. That is worse than
      // the duplicate, and it was reproduced on staging. Fixing this properly
      // needs serialisation Odoo's RPC does not offer here.
      //
      // What matters is bounded: another RESTAURANT's tax can never be lost,
      // because the write never names it. A same-restaurant duplicate is
      // detected on the next open and the screen says so, and picking a rate
      // clears it.
    }
    if (vals.uom_id) {
      const uom = await odoo.searchRead('uom.uom', [['id', '=', vals.uom_id as number], ['active', '=', true]], ['id', 'category_id'], { limit: 1 });
      if (uom.length === 0) return NextResponse.json({ error: 'That unit no longer exists' }, { status: 400 });
      // Compare unit FAMILIES (uom.category): same family → keep the purchase
      // unit as-is; different family → the old purchase unit becomes invalid in
      // Odoo, so realign it to the new base unit.
      const curr = await odoo.searchRead('product.product', [['id', '=', productId]],
        ['uom_id'], { limit: 1, context: { active_test: false } });
      const currUomId = Array.isArray(curr[0]?.uom_id) ? curr[0].uom_id[0] : null;
      if (currUomId) {
        const currUom = await odoo.searchRead('uom.uom', [['id', '=', currUomId]], ['category_id'], { limit: 1 });
        const catOf = (r: any) => (Array.isArray(r?.category_id) ? r.category_id[0] : r?.category_id);
        if (currUom.length > 0 && catOf(uom[0]) !== catOf(currUom[0])) {
          vals.uom_po_id = vals.uom_id;
        }
      }
    }
    // Request language ON PURPOSE: name/description are translated fields —
    // forcing en_US here would overwrite the ENGLISH translation from a German
    // session. The TRACKING_LOCKED mapping below matches both the English and
    // German wording of the refusal instead.
    await odoo.write('product.product', [productId], vals);

    return NextResponse.json({ message: 'Product updated' });
  } catch (err: unknown) {
    // Odoo's own validation (e.g. UoM category change on a used product) —
    // show its reason so the manager knows WHY it was refused.
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products PUT]', msg);
    // Odoo permanently locks the tracking switch once a product has history
    // ("was already used"). Say that in kitchen language, with the way out.
    if (/inventory tracking of a product that was already used/i.test(msg)
        || /Bestandsverfolgung.*bereits benutzt/i.test(msg)) {   // de_DE wording (verified against Odoo 18 i18n)
      return NextResponse.json({
        error: 'Odoo locks this switch once a product has history (purchases, recipes or stock movements). You can still count this product — its counts stay recorded in the portal; only Odoo\u2019s own stock number stays untracked.',
        code: 'TRACKING_LOCKED',
      }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * PATCH /api/inventory/products/[id]  { active: boolean }
 *
 * Archive or bring back a product. Archiving is what Odoo itself does when you
 * "delete" something that has history: it disappears from lists, counts, order
 * guides and the POS, and everything it was part of still reads correctly.
 * Reversible, which is why it is the ordinary action and DELETE is not.
 */
/**
 * Most products in this Odoo are GLOBAL (company_id = false) — 1067 of 1193 —
 * and a shared product genuinely belongs to everyone, so any manager with the
 * permission may archive or delete it. But a product TAGGED to one restaurant
 * is that restaurant's, and a manager scoped elsewhere has no business
 * archiving or deleting it.
 */
function companyDenial(
  user: { role: string; allowed_company_ids: string | null },
  productCompany: [number, string] | false | null | undefined,
): NextResponse | null {
  const owner = Array.isArray(productCompany) ? productCompany[0] : null;
  if (owner == null) return null;                     // global — shared by design
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (user.role === 'admin' && allowed.length === 0) return null;   // unrestricted admin
  if (allowed.includes(owner)) return null;
  return NextResponse.json({
    error: `This product belongs to ${Array.isArray(productCompany) ? productCompany[1] : 'another restaurant'}. Ask someone there to change it.`,
    code: 'WRONG_COMPANY',
  }, { status: 403 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'active must be true or false' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const [existing] = await odoo.searchRead(
      'product.product', [['id', '=', productId]], ['id', 'product_tmpl_id', 'name', 'company_id'],
      { limit: 1, context: { active_test: false } },
    ) as { id: number; product_tmpl_id: [number, string]; name: string; company_id: [number, string] | false }[];
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const denied = companyDenial(user, existing.company_id);
    if (denied) return denied;

    // Archiving the TEMPLATE is right for a product that IS its template, and
    // wrong for one variant of several: Odoo cascades a template archive to
    // every variant, so putting away one flavour would take its siblings with
    // it — and unarchiving would revive variants somebody archived on purpose.
    // So: template when it has one variant, the variant alone when it has more.
    const tmplId = Array.isArray(existing.product_tmpl_id) ? existing.product_tmpl_id[0] : null;
    let siblingCount = 1;
    if (tmplId) {
      const variants = await odoo.searchRead(
        'product.product', [['product_tmpl_id', '=', tmplId]], ['id'],
        { limit: 5, context: { active_test: false } },
      );
      siblingCount = variants.length || 1;
    }
    // A write that TIMES OUT may still have committed. Reporting that as a
    // failure is the worst outcome: the caller keeps showing a product that IS
    // archived, which is the exact staleness this module was just fixed for.
    // So on any error, go and look before deciding.
    try {
      if (tmplId && siblingCount === 1) await odoo.write('product.template', [tmplId], { active: body.active });
      else await odoo.write('product.product', [productId], { active: body.active });
    } catch (err: unknown) {
      const [after] = await odoo.searchRead(
        'product.product', [['id', '=', productId]], ['id', 'active'],
        { limit: 1, context: { active_test: false } },
      ).catch(() => []) as { id: number; active: boolean }[];
      if (!after || after.active !== body.active) {
        // It really did not happen — report it as written, nothing changed.
        throw err;
      }
      console.warn('[inventory] archive of', productId, 'reported an error but DID commit — treating as success:', err);
    }

    // Same reason as the delete path: the Odoo write above already happened, so
    // a log failure must not be reported as an archive failure — that would
    // leave the caller's list showing a product that IS archived.
    try {
      logAudit({
        user_id: user.id, module: 'inventory',
        action: body.active ? 'product.unarchive' : 'product.archive',
        target_type: 'product', target_id: productId, detail: existing.name,
      });
    } catch (e) { console.error('[inventory] archive audit log failed for', productId, e); }
    return NextResponse.json({ ok: true, active: body.active, name: existing.name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/inventory/products/[id]
 *
 * A real delete, which Odoo permits only while nothing has ever used the
 * product. Almost every real product will refuse — that refusal IS the answer,
 * so it is passed back in plain words rather than hidden behind a generic 500.
 *
 * The portal keeps its own records against a product id, and a submitted or
 * APPROVED count is the record of what was on a shelf that day. Deleting the
 * product would leave those numbers with no name — and would strand a
 * submitted count, which can never be approved once one of its lines is no
 * longer on the list. Refused here before Odoo is even asked.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (!Number.isFinite(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  initInventoryTables();

  // AUTHORISE FIRST. The guards below describe the product — which counting lists
  // name it, how many orders it is on — and those descriptions are information.
  // Running them before the ownership check let a manager probe another
  // restaurant's product id and be told about its orders instead of being turned
  // away.
  const odooEarly = getOdoo();
  const [owner] = await odooEarly.searchRead(
    'product.product', [['id', '=', productId]], ['id', 'company_id'],
    { limit: 1, context: { active_test: false } },
  ) as { id: number; company_id: [number, string] | false }[];
  if (!owner) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  const deniedEarly = companyDenial(user, owner.company_id);
  if (deniedEarly) return deniedEarly;

  // Refuse while any counted number depends on this product — including a count
  // still open on someone's tablet right now. Naming what is in the way is the
  // point: "it is in a count" gives a manager nothing to do about it.
  // Scoped: a manager is told something is in the way, never another
  // restaurant's list name.
  //
  // An unrestricted admin passes `null` (no narrowing). A manager whose company
  // list is genuinely EMPTY must pass `[]`, not null — null means "every company"
  // in that helper, so the old `length > 0 ? visible : null` handed a
  // misconfigured manager every restaurant's list names.
  const visible = isUnrestrictedAdmin(user) ? null : parseCompanyIds(user.allowed_company_ids);
  const work = describeCountWorkForProduct(productId, visible);
  if (work.total > 0) {
    // A draft is ALREADY inactive, so "archive it" is a no-op that would relabel
    // a product awaiting review as archived. Reject in Review is its real way out.
    const isDraft = isDraftProduct(productId);
    const what = work.where.length > 0
      ? work.where.join(', ')
      : `${work.lockedLines} line${work.lockedLines === 1 ? '' : 's'} in a submitted or approved count`;
    // Say what archiving ACTUALLY does. It hides the product from searching and
    // from adding to lists — it does NOT take it off a list that already names
    // it, and such a list still counts it. Promising otherwise is the same lie
    // this module was just fixed for.
    const wayOut = isDraft
      ? 'Reject it in Review instead — that clears its counts and closes the draft.'
      : 'Archive it instead: every number is kept, and it stops turning up in searches and when adding products. If it is on a counting list, take it off there as well.';
    return NextResponse.json({
      error: `Someone has already counted this product — ${what}. Deleting it would erase those numbers. ${wayOut}`,
      code: 'IN_LOCKED_COUNT',
      canArchive: !isDraft,
      work,
    }, { status: 409 });
  }

  // ...and refuse while anything ELSE in this portal still points at it.
  //
  // The count check above looked at two tables. Twenty-four tables across six
  // modules hold an Odoo product id — orders, receipts, printed container
  // labels, prep sales history, cook profiles, open carts — and Odoo cannot
  // protect any of them, because Odoo does not know they exist. Deleting a
  // product used by one of those left a row pointing at an id nothing could
  // resolve, inside a screen that shows history.
  const usage = describeProductUsage(productId);
  if (usage.used) {
    return NextResponse.json({
      error: `This product can’t be deleted — it is ${usage.blocking.join(', and ')}. `
        + 'Archive it instead: everything above keeps working, and it stops turning up in '
        + 'searches and when adding products.',
      code: 'STILL_IN_USE',
      canArchive: !isDraftProduct(productId),
      blocking: usage.blocking,
    }, { status: 409 });
  }

  try {
    const odoo = getOdoo();
    const [existing] = await odoo.searchRead(
      'product.product', [['id', '=', productId]], ['id', 'product_tmpl_id', 'name', 'company_id'],
      { limit: 1, context: { active_test: false } },
    ) as { id: number; product_tmpl_id: [number, string]; name: string; company_id: [number, string] | false }[];
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const denied = companyDenial(user, existing.company_id);
    if (denied) return denied;

    const tmplId = Array.isArray(existing.product_tmpl_id) ? existing.product_tmpl_id[0] : null;
    // ONLY the unlink may be read as a refusal. Tidying up afterwards used to
    // sit inside the same try, so a timeout on the follow-up read reported
    // "Odoo will not delete this" about a product that was already gone — and
    // skipped the cleanup for good, because the retry then 404s.
    try {
      await odoo.unlink('product.product', [productId]);
    } catch (err: unknown) {
      // The delete may have COMMITTED and only the response been lost — a
      // timeout looks identical to a refusal from here. Look before calling it
      // a refusal, or the caller keeps a product that no longer exists and puts
      // its id back on the next save.
      const [still] = await odoo.searchRead(
        'product.product', [['id', '=', productId]], ['id'],
        { limit: 1, context: { active_test: false } },
      ).catch(() => [{ id: productId }]) as { id: number }[];
      if (still) {
        // Genuinely still there: Odoo's refusal is the useful part — it names
        // what is still using the product.
        const raw = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          error: 'Odoo will not delete this product because something still uses it — archive it instead.',
          detail: raw.slice(0, 400),
          code: 'ODOO_REFUSED',
        }, { status: 409 });
      }
      console.warn('[inventory] delete of', productId, 'reported an error but the product IS gone — continuing cleanup:', err);
    }

    // Past this line the product IS gone, so nothing below may fail the request.
    // Orphan rows beat a lie, but a SILENT orphan is how a deleted id comes back:
    // this transaction also strips the id from every counting list, so if it
    // rolls back the product stays on lists that can never render it.
    let preserved = 0;
    try { preserved = deleteProductPortalData(productId).countWorkPreserved; }
    catch (e) { console.error('[inventory] portal cleanup FAILED after deleting product', productId, '- its id may still be on counting lists:', e); }
    if (preserved > 0) {
      console.warn('[inventory] product', productId, 'was deleted while', preserved, 'count entries arrived — they were KEPT, not erased');
    }
    // A template left behind with no variants is litter.
    if (tmplId) {
      try {
        const siblings = await odoo.searchRead(
          'product.product', [['product_tmpl_id', '=', tmplId]], ['id'],
          { limit: 1, context: { active_test: false } },
        );
        if (siblings.length === 0) await odoo.unlink('product.template', [tmplId]);
      } catch { /* the variant is gone; a stray template is cosmetic */ }
    }

    // The one irreversible action in the module — it leaves a trace. Wrapped
    // like its neighbours above: the product is already gone, so a failure to
    // WRITE THE LOG must not report the delete as failed. It did happen; a
    // caller told otherwise leaves the deleted id on its lists and puts it back
    // on the next save.
    try {
      logAudit({
        user_id: user.id, module: 'inventory', action: 'product.delete',
        target_type: 'product', target_id: productId, detail: existing.name,
      });
    } catch (e) { console.error('[inventory] delete audit log failed for', productId, e); }
    return NextResponse.json({
      ok: true,
      deleted: existing.name,
      // Somebody counted it while it was being deleted. Their numbers were kept,
      // and the manager is told rather than left to find out.
      ...(preserved > 0 ? {
        warning: `Someone counted this product while it was being deleted. Those ${preserved} number${preserved === 1 ? '' : 's'} were kept.`,
      } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
