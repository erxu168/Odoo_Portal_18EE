/**
 * GET /api/inventory/products
 *
 * Proxies product.product from Odoo 18 EE.
 * Query params: ?category_id=32&search=soju&limit=100&ids=891,950,938&include_pos=1
 *
 * Scope: defaults to raw stock only (excludes POS-sellable items so the
 * ad-hoc browse isn't flooded with menu items). POS-sellable products ARE
 * returned when the caller passes explicit `ids` (a count template listed
 * them) or `include_pos=1` (config screens: product settings, list builder).
 * Includes archived (active=False) products so draft products created via the
 * scan-to-count flow show up during review.
 *
 * POST /api/inventory/products
 *
 * Creates a draft product in Odoo (active=False) with a barcode attached.
 * Used by the "scan unknown barcode" flow. Manager later approves,
 * links to existing, or rejects via the other product endpoints.
 *
 * Body: { barcode: string, name: string }
 * Returns: { product: { id, name, categ_id, uom_id, barcode, active } }
 */
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides, parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, registerDraftProduct, isDraftProduct, listTemplates } from '@/lib/inventory-db';

// Process-level cache for the default category and UOM IDs.
let _defaultCategId: number | null = null;
let _defaultUomId: number | null = null;

// ── Relevance filter (per company) ──
// Most products in this Odoo are GLOBAL (company_id = false) — verified on
// staging 2026-07-18: 1067 of 1193 browse products are shared, 0 are tagged
// to Ssam — so company scoping alone cannot hide another restaurant's items.
// "Relevant to company X" = X actually touches the product: it has a stock
// quant in X, is a component of one of X's (or a shared) BOM, sits on one of
// X's purchase lines, or is referenced by a portal counting template.
// Company-TAGGED products are always shown regardless (see domain below).
const RELEVANT_TTL_MS = 5 * 60 * 1000;
const _relevantCache = new Map<number, { ids: number[]; at: number }>();

/**
 * searchRead everything matching `domain`, paginating by an id cursor so a
 * large set is never silently truncated (Odoo returns at most `limit` rows
 * with no truncation marker). Logs loudly if the hard cap is ever hit.
 */
async function readAllByIdCursor(
  model: string,
  domain: any[],
  fields: string[],
  pageSize = 5000,
  maxPages = 10,
): Promise<any[]> {
  const odoo = getOdoo();
  const out: any[] = [];
  let lastId = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = await odoo.searchRead(model, [...domain, ['id', '>', lastId]],
      ['id', ...fields], { limit: pageSize, order: 'id asc' });
    out.push(...rows);
    if (rows.length < pageSize) return out;
    lastId = rows[rows.length - 1].id;
  }
  console.warn(`[relevant-products] ${model} hit the ${pageSize * maxPages}-row cap — relevance set may be incomplete`);
  return out;
}

async function getRelevantProductIds(companyId: number): Promise<number[]> {
  const hit = _relevantCache.get(companyId);
  if (hit && Date.now() - hit.at < RELEVANT_TTL_MS) return hit.ids;
  // Evict OTHER companies' expired entries so arbitrary company ids can't
  // grow the map forever. This company's expired entry stays until a
  // successful refresh overwrites it — during an Odoo outage every request
  // then consistently serves the stale set (and retries the refresh).
  _relevantCache.forEach((v, k) => {
    if (k !== companyId && Date.now() - v.at >= RELEVANT_TTL_MS) _relevantCache.delete(k);
  });

  try {
    const ids = new Set<number>();
    const addProduct = (row: { product_id: number | [number, string] | false }) => {
      const pid = Array.isArray(row.product_id) ? row.product_id[0] : row.product_id;
      if (pid) ids.add(pid as number);
    };

    // 1. Has stock in this company (any quant row, incl. qty 0 history rows)
    (await readAllByIdCursor('stock.quant',
      [['company_id', '=', companyId]], ['product_id'])).forEach(addProduct);

    // 2. Component of this company's (or a shared) BOM
    const boms = await readAllByIdCursor('mrp.bom',
      [['company_id', 'in', [companyId, false]]], []);
    if (boms.length > 0) {
      (await readAllByIdCursor('mrp.bom.line',
        [['bom_id', 'in', boms.map((b: { id: number }) => b.id)]], ['product_id'])).forEach(addProduct);
    }

    // 3. On one of this company's purchase order lines
    (await readAllByIdCursor('purchase.order.line',
      [['company_id', '=', companyId]], ['product_id'])).forEach(addProduct);

    // 4. Referenced by an ACTIVE counting template whose location belongs to
    // this company (templates point at Odoo stock.location; a template from
    // another restaurant must not make its products relevant here).
    const templates = listTemplates({ active: true });
    if (templates.length > 0) {
      const locIds = Array.from(new Set(templates.map(t => t.location_id).filter(Boolean)));
      const locs = locIds.length > 0
        ? await readAllByIdCursor('stock.location', [['id', 'in', locIds]], ['company_id'])
        : [];
      const locCompany = new Map<number, number | false>(locs.map((l: any) =>
        [l.id, Array.isArray(l.company_id) ? l.company_id[0] : l.company_id]));
      for (const t of templates) {
        const c = locCompany.get(t.location_id);
        // Include when the template's location is this company's or shared/unknown
        if (c === companyId || c === false || c == null) {
          for (const pid of t.product_ids || []) ids.add(pid);
        }
      }
    }

    const arr = Array.from(ids);
    _relevantCache.set(companyId, { ids: arr, at: Date.now() });
    return arr;
  } catch (e) {
    // A stale set beats failing open (all shared products) or closed (none)
    if (hit) {
      console.error('[relevant-products] refresh failed — serving stale cache:', e);
      return hit.ids;
    }
    throw e;
  }
}

async function getDefaultCategId(): Promise<number> {
  if (_defaultCategId !== null) return _defaultCategId;
  const odoo = getOdoo();
  const rows = await odoo.searchRead(
    'product.category',
    [['name', '=', 'All']],
    ['id'],
    { limit: 1 },
  );
  if (rows.length === 0) {
    throw new Error("Default category 'All' not found — configure in Odoo");
  }
  const id = rows[0].id as number;
  _defaultCategId = id;
  return id;
}

async function getDefaultUomId(): Promise<number> {
  if (_defaultUomId !== null) return _defaultUomId;
  const odoo = getOdoo();
  const rows = await odoo.searchRead(
    'uom.uom',
    [['name', '=', 'Units']],
    ['id'],
    { limit: 1 },
  );
  if (rows.length === 0) {
    throw new Error("Default UOM 'Units' not found — configure in Odoo");
  }
  const id = rows[0].id as number;
  _defaultUomId = id;
  return id;
}

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initInventoryTables();

  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get('category_id');
  const search = searchParams.get('search');
  const ids = searchParams.get('ids');
  const limit = parseInt(searchParams.get('limit') || '200');

  try {
    const odoo = getOdoo();
    // POS-sellable items are included when the caller lists explicit ids
    // (from a count template) or asks via include_pos=1 (config screens).
    // Otherwise they're excluded so the browse stays raw-stock only.
    const includePos = searchParams.get('include_pos') === '1' || !!ids;
    const domain: any[] = [['type', '=', 'consu']];
    if (!includePos) domain.push(['available_in_pos', '=', false]);

    // Filter by explicit product IDs (from counting template)
    let hasIdFilter = false;
    if (ids) {
      const idList = ids.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      if (idList.length > 0) {
        domain.push(['id', 'in', idList]);
        hasIdFilter = true;
      }
    }

    if (categoryId) domain.push(['categ_id', '=', parseInt(categoryId)]);

    // Product name search: match the internal name OR the order code
    // (default_code) OR the supplier's name/code. Supplier fields live on
    // product.supplierinfo (a separate model) so they can't be a reliable dotted
    // domain — hydrate matching products in a second query, then OR their ids in.
    // Staff always SEE the internal name; code/supplier are only ways to find it.
    const supplierMatchIds: number[] = [];
    const supplierByVariant: Record<number, string> = {};
    const supplierByTmpl: Record<number, string> = {};
    if (search) {
      try {
        const sellers = await odoo.searchRead('product.supplierinfo',
          ['|', ['product_name', 'ilike', search], ['product_code', 'ilike', search]],
          ['product_id', 'product_tmpl_id', 'product_name', 'product_code'],
          { limit: 500 });
        const tmplIds = new Set<number>();
        for (const s of sellers) {
          const text = (s.product_name || s.product_code || '').toString();
          const variantId = Array.isArray(s.product_id) ? s.product_id[0] : null;
          const tmplId = Array.isArray(s.product_tmpl_id) ? s.product_tmpl_id[0] : null;
          if (variantId) {
            supplierMatchIds.push(variantId);
            if (text && !supplierByVariant[variantId]) supplierByVariant[variantId] = text;
          } else if (tmplId) {
            tmplIds.add(tmplId);
            if (text && !supplierByTmpl[tmplId]) supplierByTmpl[tmplId] = text;
          }
        }
        if (tmplIds.size > 0) {
          const variants = await odoo.searchRead('product.product',
            [['product_tmpl_id', 'in', Array.from(tmplIds)]], ['id'],
            { limit: 2000, context: { active_test: false } });
          for (const v of variants) supplierMatchIds.push(v.id);
        }
      } catch (e) {
        // Best-effort: fall back to name + order-code matching only.
        console.error('supplier search failed — matching name/order code only:', e);
      }
      domain.push('|', '|', ['name', 'ilike', search], ['default_code', 'ilike', search], ['id', 'in', supplierMatchIds]);
    }

    // Company scope — only on the open browse (skipped when an explicit `ids`
    // filter was applied, since those are an already-curated set, e.g. a
    // counting template's products). A product is visible to a company when it
    // is SHARED (company_id = false) OR owned by that company. This keeps
    // products shared across restaurants (e.g. Ssam + What a Jerk) while hiding
    // another company's own products. Active company comes from the top-bar
    // switcher (?company_id=, else the kw_company_id cookie); guarded by the
    // user's allowed companies so a stale/forged cookie can't widen access.
    if (!hasIdFilter) {
      const activeCompany = parseInt(searchParams.get('company_id') || '0', 10)
        || parseInt(cookies().get('kw_company_id')?.value || '0', 10);
      const allowedIds = parseCompanyIds(user.allowed_company_ids);
      // Only a full admin with no company restriction is trusted to browse any
      // company via the switcher. A non-admin (incl. one with an empty/no
      // company assignment) may only scope to a company they're explicitly
      // allowed; anything else falls back to their allowed set.
      const adminUnrestricted = user.role === 'admin' && allowedIds.length === 0;
      if (activeCompany && (adminUnrestricted || allowedIds.includes(activeCompany))) {
        // relevant=1 (browse/settings screens): shared products only show when
        // the active company actually uses them; company-tagged always show.
        let relevantIds: number[] | null = null;
        if (searchParams.get('relevant') === '1') {
          try {
            relevantIds = await getRelevantProductIds(activeCompany);
          } catch (e) {
            // Fail CLOSED: with no cache and Odoo erroring, show company-tagged
            // products only — never dump all shared products on the screen.
            console.error('relevant-products lookup failed — showing company-tagged only:', e);
            relevantIds = [];
          }
        }
        // Relevance is a FOCUS hint, not a hard exclusion: only narrow to the
        // relevant set when it's non-empty. An empty set (a company that doesn't
        // yet touch any product) or a failed lookup must NOT collapse the screen
        // to company-tagged-only (≈0, since products are shared) — fall back to
        // "shared OR this company" so Settings/List-builder always show products.
        if (relevantIds && relevantIds.length > 0) {
          domain.push('|', ['company_id', '=', activeCompany],
            '&', ['company_id', '=', false], ['id', 'in', relevantIds]);
        } else {
          domain.push('|', ['company_id', '=', false], ['company_id', '=', activeCompany]);
        }
      } else if (allowedIds.length > 0) {
        domain.push('|', ['company_id', '=', false], ['company_id', 'in', allowedIds]);
      } else if (!adminUnrestricted) {
        // Non-admin with no usable company signal: fail closed to shared-only.
        domain.push(['company_id', '=', false]);
      }
    } else {
      // Explicit ids: still constrain to company-VISIBLE products (shared OR the
      // caller's companies) so an id list can't enumerate another company's products.
      const allowedIds = parseCompanyIds(user.allowed_company_ids);
      const adminUnrestricted = user.role === 'admin' && allowedIds.length === 0;
      if (!adminUnrestricted) {
        if (allowedIds.length > 0) domain.push('|', ['company_id', '=', false], ['company_id', 'in', allowedIds]);
        else domain.push(['company_id', '=', false]);
      }
    }

    const products = await odoo.searchRead('product.product', domain,
      ['id', 'name', 'default_code', 'product_tmpl_id', 'categ_id', 'uom_id', 'type', 'barcode', 'active', 'available_in_pos', 'company_id'],
      { limit, order: 'categ_id, name', context: { active_test: false } }
    );

    // Tag portal-created drafts, and surface the internal display name + order
    // code + (when matched) the supplier's wording so the picker can show the
    // friendly name with a confirming subtitle. display_name is always the
    // internal product name — the order code/supplier are search/confirm aids.
    const tagged = products.map((p: any) => {
      const tmplId = Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : null;
      const supplierRef = supplierByVariant[p.id] || (tmplId != null ? supplierByTmpl[tmplId] : undefined);
      return {
        ...p,
        default_code: p.default_code || null,
        display_name: p.name,
        supplier_ref: supplierRef || null,
        is_draft: p.active === false && isDraftProduct(p.id),
      };
    });

    return NextResponse.json({ products: tagged });
  } catch (err: any) {
    console.error('Inventory products error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.product.create', getPermissionOverrides())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  initInventoryTables();

  try {
    const body = await request.json();
    const barcode = (body.barcode || '').trim();
    const name = (body.name || '').trim();

    if (!barcode || barcode.length < 4) {
      return NextResponse.json({ error: 'barcode must be at least 4 chars' }, { status: 400 });
    }
    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'name must be at least 2 chars' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Reject if the barcode already exists on any product — active or
    // inactive, POS or non-POS. We don't want to orphan a POS product's
    // barcode by creating a duplicate.
    const existing = await odoo.searchRead(
      'product.product',
      [['barcode', '=', barcode]],
      ['id', 'name', 'active', 'available_in_pos'],
      { limit: 1, context: { active_test: false } },
    );
    if (existing.length > 0) {
      const hint = existing[0].available_in_pos ? ' (POS item)' : '';
      return NextResponse.json(
        { error: `Barcode already exists on product: ${existing[0].name}${hint}` },
        { status: 409 },
      );
    }

    const categId = await getDefaultCategId();
    const uomId = await getDefaultUomId();

    const newId = await odoo.create('product.product', {
      name,
      barcode,
      categ_id: categId,
      uom_id: uomId,
      uom_po_id: uomId,
      type: 'consu',
      active: false,
    });

    registerDraftProduct(newId, barcode, (user as any).id);

    // Re-read to return a consistent shape with GET response
    const rows = await odoo.searchRead(
      'product.product',
      [['id', '=', newId]],
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active', 'available_in_pos'],
      { limit: 1, context: { active_test: false } },
    );

    return NextResponse.json({ product: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
