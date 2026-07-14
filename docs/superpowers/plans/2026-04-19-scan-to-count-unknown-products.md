# Scan-to-Count Unknown Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff scan any barcode (including unknown) and create a draft
product on the fly. Manager approves, links to existing, or rejects during
review.

**Architecture:** Draft products are created directly in Odoo with
`active=False`. After manager approves they become `active=True`. No new
SQLite schema, no custom Odoo module. Review UI determines "draft" state by
checking `active` on the Odoo product record.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3, Odoo 18 EE
JSON-RPC, OWL-independent React components. No test runner in this repo —
verification is `npm run build` + manual click-through + commit (per
CLAUDE.md convention).

---

## Spec reference

See [docs/superpowers/specs/2026-04-19-scan-to-count-unknown-products-design.md](docs/superpowers/specs/2026-04-19-scan-to-count-unknown-products-design.md).
Deviation from spec: no new `is_draft_product` SQLite column. Using Odoo's
`active` field as source of truth is simpler and avoids migration. Count
lines referencing draft products already work with existing tables —
`quick_counts.product_id` and `count_entries.product_id` just point to
Odoo IDs regardless of `active` state.

## POS products are excluded everywhere

**Scope addition:** the inventory module counts raw stock only — not items
that are sellable on the POS. Every product query in the inventory module
excludes POS products via `['available_in_pos', '=', False]`. This applies
to:

- Barcode lookup (so scanning a POS barcode returns "not found")
- Product list queries (so POS items don't appear in Quick Count / review)
- Link-to-existing search (managers can't link a draft to a POS product)

This is a tightening of the existing behavior — previously the inventory
module's `GET /api/inventory/products` returned all consumables including
POS items. We're narrowing that now. If a user was relying on POS items
appearing in inventory counts, they'll need to either unset
`available_in_pos` on those products in Odoo or revisit this filter.

## File structure

**Modified:**
- `src/app/api/inventory/barcode-lookup/route.ts` — include inactive
  products in GET so rescans dedupe; return `is_draft` flag
- `src/app/api/inventory/products/route.ts` — add POST for draft creation;
  update GET to include inactive products when querying by `ids=`
- `src/lib/inventory-db.ts` — add helpers to reassign and delete count
  lines by product_id (for link/reject actions)
- `src/components/ui/BarcodeScanner.tsx` — render draft-creation sheet on
  unknown-barcode state; refresh local products after creation; "Pending
  review" badge for draft on rescan
- `src/components/inventory/ReviewSubmissions.tsx` — pending pill for
  inactive products; inline review panel with approve/link/reject

**New:**
- `src/app/api/inventory/products/[id]/approve/route.ts`
- `src/app/api/inventory/products/[id]/link/route.ts`
- `src/app/api/inventory/products/[id]/reject/route.ts`

**Unchanged:**
- `src/hooks/useHardwareScanner.ts`
- `src/components/inventory/QuickCount.tsx`
- `src/components/inventory/CountingSession.tsx`
- `src/app/api/inventory/quick-count/route.ts`

---

## Task 1: Backend — barcode-lookup includes inactive products

Goal: When staff B scans a barcode that staff A just created as a draft,
the lookup should return it so staff B can add qty instead of creating a
duplicate.

**Files:**
- Modify: `src/app/api/inventory/barcode-lookup/route.ts`

- [ ] **Step 1: Add `active` to the searchRead fields and remove implicit active filter**

Replace the `product.product` search block in the GET handler. The current
code returns only active products. Add `active` to the fields list and
pass `active_test: false` via context so inactive drafts are also
findable.

Edit `src/app/api/inventory/barcode-lookup/route.ts` lines 24-34:

```typescript
    // 1. Direct match on product.product — include inactive drafts,
    //    exclude POS products (we only count raw stock in this module)
    const products = await odoo.searchRead(
      'product.product',
      [
        ['barcode', '=', barcode],
        ['type', '=', 'consu'],
        ['available_in_pos', '=', false],
      ],
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (products.length > 0) {
      const p = products[0];
      return NextResponse.json({
        found: true,
        product: p,
        source: 'product',
        is_draft: p.active === false,
      });
    }
```

Check `src/lib/odoo.ts` — the `searchRead` signature in the current
client takes `options: { limit, offset, order }` but does NOT take
`context`. Look at lines 177-200 in `src/lib/odoo.ts`. You will need to
extend the options type to accept an optional `context` field and pass
it into the kwargs, OR use a lower-level `call` to pass context
directly. Preferred: extend `searchRead`.

- [ ] **Step 2: Extend searchRead signature in odoo.ts to accept context**

Edit `src/lib/odoo.ts` lines 177-200:

```typescript
  async searchRead(
    model: string,
    domain: any[] = [],
    fields: string[] = [],
    options: {
      limit?: number;
      offset?: number;
      order?: string;
      context?: Record<string, any>;
    } = {},
  ): Promise<any[]> {
    await this.ensureAuth();
    return this.rpc('/web/dataset/call_kw', {
      model,
      method: 'search_read',
      args: [domain],
      kwargs: {
        fields,
        limit: options.limit || 200,
        offset: options.offset || 0,
        order: options.order || '',
        context: { ...this.getContext(), ...(options.context || {}) },
      },
    });
  }
```

- [ ] **Step 3: Also handle the packaging branch for `is_draft`**

Edit `src/app/api/inventory/barcode-lookup/route.ts` lines 36-54. Update
the product.packaging lookup path to also fetch `active` and report
`is_draft`:

```typescript
    // 2. Check product.packaging (alternate barcodes) — only match if the
    //    underlying product is non-POS
    const packagings = await odoo.searchRead(
      'product.packaging',
      [['barcode', '=', barcode]],
      ['id', 'name', 'product_id', 'barcode'],
      { limit: 1 },
    );
    if (packagings.length > 0 && packagings[0].product_id) {
      const prodId = packagings[0].product_id[0];
      const prods = await odoo.searchRead(
        'product.product',
        [
          ['id', '=', prodId],
          ['available_in_pos', '=', false],
        ],
        ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active'],
        { limit: 1, context: { active_test: false } },
      );
      if (prods.length > 0) {
        const p = prods[0];
        return NextResponse.json({
          found: true,
          product: p,
          source: 'packaging',
          is_draft: p.active === false,
        });
      }
    }
```

- [ ] **Step 4: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: build succeeds (exit 0). If TypeScript errors, fix them before
committing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/barcode-lookup/route.ts src/lib/odoo.ts
git commit -m "[IMP] inventory: barcode-lookup returns inactive products with is_draft flag"
```

---

## Task 2: Backend — POST /api/inventory/products creates draft

Goal: Staff-triggered endpoint that creates `product.product` in Odoo
with `active=False` so it's hidden from normal lists until approved.

**Files:**
- Modify: `src/app/api/inventory/products/route.ts`

- [ ] **Step 1: Add cached-lookup helpers for default category/UOM**

Add to the top of `src/app/api/inventory/products/route.ts`, above the
GET handler:

```typescript
import { getOdoo } from '@/lib/odoo';

// Process-level cache for the default category and UOM IDs.
let _defaultCategId: number | null = null;
let _defaultUomId: number | null = null;

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
  _defaultCategId = rows[0].id;
  return _defaultCategId;
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
  _defaultUomId = rows[0].id;
  return _defaultUomId;
}
```

Remove the duplicate `import { getOdoo } from '@/lib/odoo';` that already
exists at line 9 (the new import block replaces it).

- [ ] **Step 2: Add the POST handler**

Append to `src/app/api/inventory/products/route.ts` (after the existing
GET handler):

```typescript
/**
 * POST /api/inventory/products
 *
 * Creates a draft product in Odoo (active=False) with a barcode attached.
 * Used by the "scan unknown barcode" flow. Manager later approves,
 * links to existing, or rejects via the review endpoints.
 *
 * Body: { barcode: string, name: string }
 * Returns: { product: { id, name, categ_id, uom_id, barcode, active } }
 */
export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Re-read to return a consistent shape with GET response
    const rows = await odoo.searchRead(
      'product.product',
      [['id', '=', newId]],
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active'],
      { limit: 1, context: { active_test: false } },
    );

    return NextResponse.json({ product: rows[0] }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Update GET to exclude POS and include inactive products**

Two changes in the existing GET handler
(`src/app/api/inventory/products/route.ts` lines 20-40):

1. Exclude POS products from the base domain (scope addition — applies to
   the whole inventory module, not just this feature)
2. Include inactive products in results (so draft products show up during
   review)

Edit the domain and the searchRead call:

```typescript
    const odoo = getOdoo();
    const domain: any[] = [
      ['type', '=', 'consu'],
      ['available_in_pos', '=', false],
    ];

    // Filter by explicit product IDs (from counting template)
    if (ids) {
      const idList = ids.split(',').map(Number).filter(n => !isNaN(n) && n > 0);
      if (idList.length > 0) {
        domain.push(['id', 'in', idList]);
      }
    }

    if (categoryId) domain.push(['categ_id', '=', parseInt(categoryId)]);
    if (search) domain.push(['name', 'ilike', search]);

    const products = await odoo.searchRead('product.product', domain,
      ['id', 'name', 'categ_id', 'uom_id', 'type', 'barcode', 'active', 'available_in_pos'],
      { limit, order: 'categ_id, name', context: { active_test: false } }
    );
```

Note: `active_test: false` means archived products will also appear. The
only common source of inactive non-POS consumables in this DB is draft
products from this feature, so acceptable. If cruft accumulates, add an
explicit `['active', '=', true]` to the domain for non-review callers
and keep the inactive-inclusive lookup scoped to the review path.

- [ ] **Step 4: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/products/route.ts
git commit -m "[ADD] inventory: POST /products creates draft with active=False"
```

---

## Task 3: Backend — approve draft endpoint

Goal: Manager sets final name/category/UOM and flips `active=True`.

**Files:**
- Create: `src/app/api/inventory/products/[id]/approve/route.ts`

- [ ] **Step 1: Create the route file**

Create `src/app/api/inventory/products/[id]/approve/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/approve
 *
 * Activates a draft product with final name/category/UOM.
 * Body: { name: string, categ_id: number, uom_id: number }
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (isNaN(productId) || productId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const name = (body.name || '').trim();
    const categId = Number(body.categ_id);
    const uomId = Number(body.uom_id);

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (!categId || !uomId) {
      return NextResponse.json({ error: 'categ_id and uom_id required' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Validate the target product exists and is currently a draft
    const existing = await odoo.searchRead(
      'product.product',
      [['id', '=', productId]],
      ['id', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Validate category and UOM exist
    const categ = await odoo.searchRead('product.category', [['id', '=', categId]], ['id'], { limit: 1 });
    if (categ.length === 0) {
      return NextResponse.json({ error: 'Invalid categ_id' }, { status: 400 });
    }
    const uom = await odoo.searchRead('uom.uom', [['id', '=', uomId]], ['id'], { limit: 1 });
    if (uom.length === 0) {
      return NextResponse.json({ error: 'Invalid uom_id' }, { status: 400 });
    }

    await odoo.write('product.product', [productId], {
      name,
      categ_id: categId,
      uom_id: uomId,
      uom_po_id: uomId,
      active: true,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/approve POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/\[id\]/approve/route.ts
git commit -m "[ADD] inventory: POST /products/[id]/approve activates draft with final values"
```

---

## Task 4: Backend — link-to-existing + count reassignment

Goal: Manager maps a draft's barcode onto an existing Odoo product. Count
lines pointing at the draft get reassigned to the target product.

**Files:**
- Modify: `src/lib/inventory-db.ts`
- Create: `src/app/api/inventory/products/[id]/link/route.ts`

- [ ] **Step 1: Add reassign helper in inventory-db.ts**

Append to `src/lib/inventory-db.ts` (after `approveQuickCount`):

```typescript
/**
 * Reassign every count line (quick_counts + count_entries) that points to
 * `fromProductId` so it points to `toProductId` instead. Used when a
 * manager links a draft product to an existing product during review.
 *
 * Returns the total number of rows changed.
 */
export function reassignCountsForProduct(fromProductId: number, toProductId: number): number {
  const db = getDb();
  let changed = 0;
  changed += db.prepare('UPDATE quick_counts SET product_id = ? WHERE product_id = ?')
    .run(toProductId, fromProductId).changes;
  changed += db.prepare('UPDATE count_entries SET product_id = ? WHERE product_id = ?')
    .run(toProductId, fromProductId).changes;
  return changed;
}

/**
 * Delete every count line (quick_counts + count_entries) that points to
 * `productId`. Used when a manager rejects a draft product during review.
 *
 * Returns the total number of rows deleted.
 */
export function deleteCountsForProduct(productId: number): number {
  const db = getDb();
  let deleted = 0;
  deleted += db.prepare('DELETE FROM quick_counts WHERE product_id = ?').run(productId).changes;
  deleted += db.prepare('DELETE FROM count_entries WHERE product_id = ?').run(productId).changes;
  return deleted;
}
```

- [ ] **Step 2: Create the link route**

Create `src/app/api/inventory/products/[id]/link/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/link
 *
 * Links a draft product's barcode to an existing real product.
 * Count lines referencing the draft are reassigned to the target.
 * The draft stays active=False (effectively dead).
 *
 * Body: { target_product_id: number }
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, reassignCountsForProduct } from '@/lib/inventory-db';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const draftId = parseInt(params.id, 10);
  if (isNaN(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const body = await request.json();
    const targetId = Number(body.target_product_id);
    if (!targetId || targetId === draftId) {
      return NextResponse.json({ error: 'target_product_id required and must differ' }, { status: 400 });
    }

    const odoo = getOdoo();

    // Load draft product (must exist, must be inactive, must have barcode)
    const drafts = await odoo.searchRead(
      'product.product',
      [['id', '=', draftId]],
      ['id', 'active', 'barcode'],
      { limit: 1, context: { active_test: false } },
    );
    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft product not found' }, { status: 404 });
    }
    const draft = drafts[0];
    if (draft.active === true) {
      return NextResponse.json({ error: 'Product is not a draft' }, { status: 400 });
    }
    if (!draft.barcode) {
      return NextResponse.json({ error: 'Draft has no barcode' }, { status: 400 });
    }

    // Load target product (must exist, must be active, must NOT be POS)
    const targets = await odoo.searchRead(
      'product.product',
      [['id', '=', targetId]],
      ['id', 'name', 'barcode', 'active', 'available_in_pos'],
      { limit: 1 },
    );
    if (targets.length === 0) {
      return NextResponse.json({ error: 'Target product not found' }, { status: 404 });
    }
    const target = targets[0];
    if (target.available_in_pos === true) {
      return NextResponse.json(
        { error: 'Cannot link to a POS product — inventory counts only apply to non-POS stock' },
        { status: 400 },
      );
    }
    if (target.barcode && target.barcode !== draft.barcode) {
      return NextResponse.json(
        { error: `Target product already has barcode: ${target.barcode}` },
        { status: 409 },
      );
    }

    // Clear barcode from draft first so Odoo's unique constraint doesn't fire
    await odoo.write('product.product', [draftId], { barcode: false });
    await odoo.write('product.product', [targetId], { barcode: draft.barcode });

    // Reassign all count lines
    const rowsChanged = reassignCountsForProduct(draftId, targetId);

    return NextResponse.json({ success: true, rows_changed: rowsChanged });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/link POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/inventory-db.ts src/app/api/inventory/products/\[id\]/link/route.ts
git commit -m "[ADD] inventory: POST /products/[id]/link transfers barcode + reassigns counts"
```

---

## Task 5: Backend — reject draft endpoint

Goal: Manager rejects a draft. Count lines referencing it are deleted.
Draft stays inactive.

**Files:**
- Create: `src/app/api/inventory/products/[id]/reject/route.ts`

- [ ] **Step 1: Create the reject route**

Create `src/app/api/inventory/products/[id]/reject/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
/**
 * POST /api/inventory/products/[id]/reject
 *
 * Rejects a draft product. Any count lines referencing it are removed.
 * The draft itself stays active=False in Odoo (no-op beyond what it is).
 *
 * Manager+ only.
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';
import { initInventoryTables, deleteCountsForProduct } from '@/lib/inventory-db';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const draftId = parseInt(params.id, 10);
  if (isNaN(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    initInventoryTables();
    const odoo = getOdoo();

    const drafts = await odoo.searchRead(
      'product.product',
      [['id', '=', draftId]],
      ['id', 'active'],
      { limit: 1, context: { active_test: false } },
    );
    if (drafts.length === 0) {
      return NextResponse.json({ error: 'Draft product not found' }, { status: 404 });
    }
    if (drafts[0].active === true) {
      return NextResponse.json({ error: 'Product is not a draft' }, { status: 400 });
    }

    const rowsDeleted = deleteCountsForProduct(draftId);
    return NextResponse.json({ success: true, rows_deleted: rowsDeleted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[products/reject POST]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/\[id\]/reject/route.ts
git commit -m "[ADD] inventory: POST /products/[id]/reject deletes count lines"
```

---

## Task 6: Frontend — UnknownBarcodeSheet inside BarcodeScanner

Goal: Replace the dead-end "Unknown barcode" panel with a one-field form
that creates a draft product and records the first count.

**Files:**
- Modify: `src/components/ui/BarcodeScanner.tsx`

- [ ] **Step 1: Extend ScanResult type to carry draft-create state**

Edit `src/components/ui/BarcodeScanner.tsx` lines 6-12. Change the
`ScanResult` type union:

```typescript
type ScanResult =
  | { kind: 'scanning' }
  | { kind: 'found'; product: any; isDraft?: boolean }
  | { kind: 'looking_up'; barcode: string }
  | { kind: 'not_in_list'; barcode: string; productName: string; isDraft?: boolean }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'creating'; barcode: string; name: string }
  | { kind: 'manual' };
```

- [ ] **Step 2: Wire `is_draft` into existing "found" and "not_in_list" branches**

In the `processBarcode` function (around lines 130-157), update the
branches that handle barcode-lookup responses to carry through the new
`is_draft` flag. Replace the function body:

```typescript
  const processBarcode = useCallback(async (barcode: string) => {
    const prods = productsRef.current;
    const ents = entriesRef.current;

    // Local match first — only for active products already in the loaded list
    const product = prods.find((p: any) => p.barcode && p.barcode === barcode);
    if (product) {
      const currentQty = ents[product.id];
      setQty(currentQty !== undefined ? currentQty + 1 : 1);
      setScanResult({ kind: 'found', product, isDraft: product.active === false });
      try { navigator.vibrate(100); } catch (_e) { /* ignore */ }
      return;
    }

    setScanResult({ kind: 'looking_up', barcode });
    try { navigator.vibrate(100); } catch (_e) { /* ignore */ }

    try {
      const res = await fetch(`/api/inventory/barcode-lookup?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (data.found && data.product) {
        // Draft product hit → treat as "found" with a Pending badge so staff
        // can add qty immediately (dedupe of rescan during walk-around).
        if (data.is_draft) {
          const currentQty = ents[data.product.id];
          setQty(currentQty !== undefined ? currentQty + 1 : 1);
          setScanResult({ kind: 'found', product: data.product, isDraft: true });
          return;
        }
        setScanResult({ kind: 'not_in_list', barcode, productName: data.product.name });
      } else {
        setScanResult({ kind: 'unknown', barcode });
      }
    } catch (_err) {
      setScanResult({ kind: 'unknown', barcode });
    }
  }, []);
```

- [ ] **Step 3: Add UnknownBarcodeSheet render block and handler**

Find the existing "Unknown barcode" render block (lines 510-531) in
`src/components/ui/BarcodeScanner.tsx`. Replace the entire block with:

```tsx
      {/* ── Unknown barcode — create draft + count ── */}
      {scanResult.kind === 'unknown' && (
        <UnknownBarcodeSheet
          barcode={scanResult.barcode}
          onCancel={handleDismissResult}
          onCreated={handleDraftCreated}
        />
      )}

      {/* ── Creating draft (API in flight) ── */}
      {scanResult.kind === 'creating' && (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
          <div className="flex items-center justify-center gap-3 py-6">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-[#F5800A] rounded-full animate-spin" />
            <span className="text-[15px] text-gray-600">Creating "{scanResult.name}"...</span>
          </div>
        </div>
      )}
```

Then add the `handleDraftCreated` function near `handleConfirmCount`
(around line 266). This runs after POST /products succeeds:

```typescript
  async function handleDraftCreated(product: any, qtyValue: number) {
    // Merge into local products cache so an immediate rescan matches locally
    productsRef.current = [...productsRef.current, product];

    const uom = product.uom_id?.[1] || 'Units';
    onCount(product.id, qtyValue, uom);
    showToast(`${product.name} \u2192 ${qtyValue} ${uom}`, 'success');
    setScanResult({ kind: 'scanning' });
  }
```

- [ ] **Step 4: Add the UnknownBarcodeSheet inline component**

At the bottom of `src/components/ui/BarcodeScanner.tsx` (after the
default export's closing brace), append:

```tsx
/* ───── UnknownBarcodeSheet ───── */

interface UnknownBarcodeSheetProps {
  barcode: string;
  onCancel: () => void;
  onCreated: (product: any, qty: number) => void;
}

function UnknownBarcodeSheet({ barcode, onCancel, onCreated }: UnknownBarcodeSheetProps) {
  const [name, setName] = useState('');
  const [qtyValue, setQtyValue] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create');
        setSubmitting(false);
        return;
      }
      onCreated(data.product, qtyValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 pb-8 z-[71] animate-slideUp">
      <div className="mb-3">
        <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-1">New product</p>
        <p className="text-[12px] text-gray-500 font-mono">{barcode}</p>
      </div>

      <label className="text-[13px] font-semibold text-gray-600 mb-2 block">What is this item?</label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length >= 2) handleCreate(); }}
        placeholder="e.g. Pork belly"
        className="w-full px-4 py-3 rounded-xl bg-gray-50 border-2 border-gray-200 text-[16px] text-gray-900 focus:outline-none focus:border-[#F5800A] mb-4"
        disabled={submitting}
      />

      <div className="flex items-center justify-center gap-4 mb-5">
        <button
          onClick={() => setQtyValue((q) => Math.max(0, q - 1))}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >&minus;</button>
        <input
          type="text"
          inputMode="decimal"
          value={qtyValue}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '');
            if (v === '' || v === '.') { setQtyValue(0); return; }
            const n = parseFloat(v);
            if (!isNaN(n)) setQtyValue(n);
          }}
          className="w-24 h-14 text-center text-[32px] font-mono font-bold text-gray-900 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#F5800A]"
          disabled={submitting}
        />
        <button
          onClick={() => setQtyValue((q) => q + 1)}
          className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-[22px] font-bold text-gray-600 active:bg-gray-200 select-none"
          disabled={submitting}
        >+</button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-700 text-[15px] font-semibold active:bg-gray-200 disabled:opacity-50"
        >Cancel</button>
        <button
          onClick={handleCreate}
          disabled={submitting || name.trim().length < 2}
          className="flex-[2] py-3.5 rounded-xl bg-[#F5800A] text-white text-[15px] font-bold shadow-md shadow-[#F5800A]/30 active:bg-[#E86000] active:scale-[0.975] transition-all disabled:opacity-40"
        >{submitting ? 'Creating...' : 'Create and count'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Show "Pending review" badge on the "found" card when isDraft**

Edit the "Product found card" render block (around lines 418-474) in
`src/components/ui/BarcodeScanner.tsx`. Inside the card's header area,
next to the product name, add a pending badge. Replace the category
paragraph (line 422-424) and name header (line 425-427) with:

```tsx
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[11px] font-bold tracking-wider uppercase text-gray-400">
                  {scanResult.product.categ_id?.[1] || ''}
                </p>
                {scanResult.isDraft && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    Pending review
                  </span>
                )}
              </div>
              <h3 className="text-[18px] font-bold text-gray-900 leading-tight">
                {scanResult.product.name}
              </h3>
```

- [ ] **Step 6: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0. If TypeScript complains about `product.active` missing
from your `any`-typed prods array, note that the product type is `any`
throughout this file so it should pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/BarcodeScanner.tsx
git commit -m "[ADD] inventory: scan unknown barcode → create draft product inline"
```

---

## Task 7: Frontend — ReviewSubmissions pending pill + draft panel

Goal: Count lines pointing at inactive products get an amber "Pending
product" pill. Tapping expands a panel with Confirm / Link / Reject
actions. Submission-level approve is blocked until all drafts resolve.

**Files:**
- Modify: `src/components/inventory/ReviewSubmissions.tsx`

- [ ] **Step 1: Add draftDecisions state**

In `src/components/inventory/ReviewSubmissions.tsx`, after the existing
`const [qcConfirm, setQcConfirm] = ...` state declaration (around line
27), add:

```typescript
  const [draftDecisions, setDraftDecisions] = useState<Record<number, 'approved' | 'linked' | 'rejected'>>({});
```

Also reset it whenever a different review session is opened. Find
`setReviewSession(sess)` in the `openReview` function (around line 62)
and add right after it:

```typescript
    setDraftDecisions({});
```

- [ ] **Step 2: Fetch inactive products when loading review data**

Find the `openReview` function (around line 60-92). In the product fetch
branches, append the full-product lookup for any draft referenced by
count entries but not in `template_product_ids`. Add this after the
existing product fetch logic, right before `setReviewProducts(...)`:

```typescript
      // Also fetch any products referenced by count entries that weren't in
      // the template list — these may be draft products created on-the-fly.
      const entryIds = (countRes.entries || []).map((e: any) => e.product_id);
      const haveIds = new Set((reviewProducts || []).map((p: any) => p.id));
      const missingIds = entryIds.filter((id: number) => !haveIds.has(id));
      let extraProducts: any[] = [];
      if (missingIds.length > 0) {
        const extra = await fetch(`/api/inventory/products?ids=${missingIds.join(',')}`).then(r => r.json());
        extraProducts = extra.products || [];
      }
```

Then merge `extraProducts` into whichever branch sets `setReviewProducts`.

**Important:** The existing code has two branches (product_ids vs
category_ids). In each branch, wherever you call
`setReviewProducts(list)`, replace with `setReviewProducts([...list,
...extraProducts])`. Position the extra-fetch block so it runs once
after *both* branches have computed their `list`. The simplest way: do
the extra fetch *after* the if/else block, track the interim list in a
local variable, and set state once. Example replacement for the
entire product-loading block inside `openReview`:

```typescript
      let productList: any[] = [];
      if (productIds.length > 0) {
        const prodRes = await fetch(`/api/inventory/products?ids=${productIds.join(',')}`).then(r => r.json());
        productList = prodRes.products || [];
      } else {
        let categoryIds: number[] = [];
        try { categoryIds = JSON.parse(sess.template_category_ids || '[]'); } catch { categoryIds = []; }
        if (categoryIds.length > 0) {
          const promises = categoryIds.map(cid => fetch(`/api/inventory/products?category_id=${cid}`).then(r => r.json()));
          const results = await Promise.all(promises);
          const seen = new Set<number>();
          results.forEach(r => (r.products || []).forEach((p: any) => { if (!seen.has(p.id)) { seen.add(p.id); productList.push(p); } }));
        }
      }

      // Pull in any products referenced by count entries that aren't yet loaded.
      const entryProductIds = (countRes.entries || []).map((e: any) => e.product_id);
      const haveIds = new Set(productList.map((p: any) => p.id));
      const missingIds = entryProductIds.filter((id: number) => !haveIds.has(id));
      if (missingIds.length > 0) {
        const extra = await fetch(`/api/inventory/products?ids=${missingIds.join(',')}`).then(r => r.json());
        productList.push(...(extra.products || []));
      }
      setReviewProducts(productList);
```

- [ ] **Step 3: Add DraftReviewPanel component inline**

At the bottom of `src/components/inventory/ReviewSubmissions.tsx`
(after the default export's closing brace), add:

```tsx
interface DraftReviewPanelProps {
  product: any;
  onApproved: () => void;
  onLinked: () => void;
  onRejected: () => void;
}

function DraftReviewPanel({ product, onApproved, onLinked, onRejected }: DraftReviewPanelProps) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'link' | 'reject'>('idle');
  const [name, setName] = useState(product.name || '');
  const [categories, setCategories] = useState<any[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [categId, setCategId] = useState<number | null>(null);
  const [uomId, setUomId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'approve') return;
    fetch('/api/inventory/categories').then(r => r.json()).then(d => setCategories(d.categories || [])).catch(() => {});
    fetch('/api/inventory/uoms').then(r => r.json()).then(d => setUoms(d.uoms || [])).catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== 'link' || search.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/inventory/products?search=${encodeURIComponent(search)}&limit=20`)
        .then(r => r.json())
        .then(d => setSearchResults((d.products || []).filter((p: any) => p.active !== false)))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, mode]);

  async function handleApprove() {
    if (!name.trim() || !categId || !uomId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), categ_id: categId, uom_id: uomId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Approve failed'); setSubmitting(false); return; }
      onApproved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  async function handleLink(target: any) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_product_id: target.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Link failed'); setSubmitting(false); return; }
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/products/${product.id}/reject`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reject failed'); setSubmitting(false); return; }
      onRejected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
      {mode === 'idle' && (
        <div className="flex gap-2">
          <button onClick={() => setMode('approve')} className="flex-1 py-2 rounded-lg bg-[#F5800A] text-white text-[13px] font-bold active:bg-[#E86000]">Confirm as new</button>
          <button onClick={() => setMode('link')} className="flex-1 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Link to existing</button>
          <button onClick={() => setMode('reject')} className="flex-1 py-2 rounded-lg bg-white border border-red-300 text-red-600 text-[13px] font-semibold active:bg-red-50">Reject</button>
        </div>
      )}

      {mode === 'approve' && (
        <div className="space-y-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]" />
          <select value={categId ?? ''} onChange={(e) => setCategId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]">
            <option value="">Select category…</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.complete_name || c.name}</option>)}
          </select>
          <select value={uomId ?? ''} onChange={(e) => setUomId(Number(e.target.value) || null)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]">
            <option value="">Select UOM…</option>
            {uoms.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode('idle')} disabled={submitting} className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Back</button>
            <button onClick={handleApprove} disabled={submitting || !name.trim() || !categId || !uomId} className="flex-[2] py-2 rounded-lg bg-[#F5800A] text-white text-[13px] font-bold disabled:opacity-40">
              {submitting ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      )}

      {mode === 'link' && (
        <div className="space-y-2">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search existing product…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-[14px]" autoFocus />
          <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
            {searchResults.map((r: any) => (
              <button key={r.id} onClick={() => handleLink(r)} disabled={submitting}
                className="text-left px-3 py-2 rounded-lg bg-white border border-gray-200 text-[13px] active:bg-gray-50">
                <span className="font-semibold text-gray-900">{r.name}</span>
                <span className="text-gray-500 ml-2">{r.categ_id?.[1]}</span>
              </button>
            ))}
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <button onClick={() => setMode('idle')} className="w-full py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Cancel</button>
        </div>
      )}

      {mode === 'reject' && (
        <div className="space-y-2">
          <p className="text-[13px] text-gray-700">Reject this product and drop its count line?</p>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode('idle')} disabled={submitting} className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-[13px] font-semibold">Back</button>
            <button onClick={handleReject} disabled={submitting} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-[13px] font-bold">
              {submitting ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render pending pill + panel inside the counted-products list**

The review UI is product-keyed, not entry-keyed. `countedProducts` is a
filtered view of `reviewProducts` where `entryMap[p.id] !== undefined`
(see `src/components/inventory/ReviewSubmissions.tsx` lines 282-284).

Locate the `countedProducts.map((p) => { ... })` block starting at line
336. Inside the returned `<div key={p.id} ...>` row (the one that
currently closes at line 362 with `</div>`), we want to:

1. Render a "Pending product" amber pill next to the product name
2. After the row's closing tag, conditionally render a `<DraftReviewPanel>`

Current structure (lines 343-362):

```tsx
return (<div key={p.id} className={`flex items-center justify-between py-2.5 border-b ${isVariance ? 'border-red-100 bg-red-50/50' : 'border-gray-100'}`}>
  <div className="flex items-center gap-2 flex-1 min-w-0">
    ...
    <div className="min-w-0">
      <span className="text-[var(--fs-base)] text-gray-900 truncate block">{p.name}</span>
      ...
    </div>
  </div>
  <span ...>{val} ...</span>
</div>);
```

Replace with a wrapper div so we can place the panel below the row in
the same iteration. New version of the return:

```tsx
const isDraft = p.active === false;
const decision = draftDecisions[p.id];
return (
  <div key={p.id}>
    <div className={`flex items-center justify-between py-2.5 border-b ${isVariance ? 'border-red-100 bg-red-50/50' : 'border-gray-100'}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isVariance ? 'bg-red-100' : 'bg-green-100'}`}>
          {isVariance ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--fs-base)] text-gray-900 truncate">{p.name}</span>
            {isDraft && !decision && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                Pending
              </span>
            )}
            {decision && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${
                decision === 'approved' ? 'bg-green-100 text-green-700 border border-green-200' :
                decision === 'linked' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                'bg-red-100 text-red-700 border border-red-200'
              }`}>{decision}</span>
            )}
          </div>
          {hasSysQty && (
            <span className={`text-[var(--fs-xs)] ${isVariance ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
              System: {sysQty} {uom} {diff !== null && `(${diff > 0 ? '+' : ''}${diff})`}
            </span>
          )}
        </div>
      </div>
      <span className="text-[14px] font-mono font-semibold text-gray-900 flex-shrink-0 ml-3">{val} <span className="text-[var(--fs-xs)] text-gray-400 font-normal">{uom}</span></span>
    </div>
    {isDraft && !decision && (
      <DraftReviewPanel
        product={p}
        onApproved={() => setDraftDecisions(d => ({ ...d, [p.id]: 'approved' }))}
        onLinked={() => setDraftDecisions(d => ({ ...d, [p.id]: 'linked' }))}
        onRejected={() => setDraftDecisions(d => ({ ...d, [p.id]: 'rejected' }))}
      />
    )}
  </div>
);
```

- [ ] **Step 5: Add memoized "has unresolved drafts" and gate the Approve button**

At the top of the component body (near the other `useMemo` / `useState`
declarations — a good spot is right after the line
`const [draftDecisions, setDraftDecisions] = useState<...>({});` you
added in Step 1), add:

```typescript
  const hasUnresolvedDrafts = React.useMemo(() => {
    return reviewProducts.some((p: any) => p.active === false && !draftDecisions[p.id]);
  }, [reviewProducts, draftDecisions]);
```

Find the Approve button (lines 381-388 — the `isSubmitted` block). The
current button is:

```tsx
<button onClick={() => setShowConfirm('approve')} className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">Approve</button>
```

Replace the whole `isSubmitted` block (lines 381-388) with:

```tsx
            {isSubmitted && (
              <div className="px-4 py-3">
                {hasUnresolvedDrafts && (
                  <p className="text-[12px] text-amber-700 mb-2 font-semibold">Resolve all pending products before approving.</p>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowConfirm('reject')} className="py-3.5 px-6 rounded-xl border border-red-200 text-red-600 text-[14px] font-bold active:bg-red-50">Reject</button>
                  <button
                    onClick={() => setShowConfirm('approve')}
                    disabled={hasUnresolvedDrafts}
                    className="flex-1 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-40 disabled:bg-gray-400 disabled:shadow-none"
                  >Approve</button>
                </div>
              </div>
            )}
```

- [ ] **Step 6: Add category + UOM list endpoints (needed by the panel)**

The DraftReviewPanel fetches `/api/inventory/categories` and
`/api/inventory/uoms`. Check whether they exist:

```bash
ls /Users/ethan/Odoo_Portal_18EE/src/app/api/inventory/categories 2>/dev/null
ls /Users/ethan/Odoo_Portal_18EE/src/app/api/inventory/uoms 2>/dev/null
```

If they don't exist, create them:

Create `src/app/api/inventory/categories/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const categories = await odoo.searchRead(
      'product.category',
      [],
      ['id', 'name', 'complete_name'],
      { limit: 500, order: 'complete_name' },
    );
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

Create `src/app/api/inventory/uoms/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOdoo } from '@/lib/odoo';

export async function GET() {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const odoo = getOdoo();
    const uoms = await odoo.searchRead(
      'uom.uom',
      [['active', '=', true]],
      ['id', 'name', 'category_id'],
      { limit: 200, order: 'name' },
    );
    return NextResponse.json({ uoms });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 7: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/components/inventory/ReviewSubmissions.tsx \
        src/app/api/inventory/categories/route.ts \
        src/app/api/inventory/uoms/route.ts
git commit -m "[ADD] inventory: review panel for pending products (approve/link/reject)"
```

---

## Task 8: Similar-product warning in review panel

Goal: When manager taps "Confirm as new", check Odoo for existing
products with similar names and show a warning so obvious duplicates
don't get created ("Chicken Breast" vs "Chicken breast", "Pork belly"
vs "Pork Belly Fresh"). Manager can still approve anyway or switch to
link mode with one tap.

This catches: typos, case differences, plural/singular, and near-miss
names that would otherwise produce duplicate products.

**Files:**
- Create: `src/app/api/inventory/products/similar/route.ts`
- Modify: `src/components/inventory/ReviewSubmissions.tsx`
  (the `DraftReviewPanel` component added in Task 7)

- [ ] **Step 1: Create the similar-products endpoint**

Create `src/app/api/inventory/products/similar/route.ts`:

```typescript
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
```

- [ ] **Step 2: Fetch similar matches when entering approve mode**

Edit the `DraftReviewPanel` component in
`src/components/inventory/ReviewSubmissions.tsx`. Add state and a fetch
effect for similar-match warnings. Find the existing state block in the
component (the one with `const [mode, setMode] = useState<...>`) and
add alongside it:

```typescript
  const [similarMatches, setSimilarMatches] = useState<any[]>([]);
```

Find the existing `useEffect` that fetches categories/uoms when
`mode === 'approve'`. Add a second effect right below it:

```typescript
  useEffect(() => {
    if (mode !== 'approve') { setSimilarMatches([]); return; }
    const trimmed = name.trim();
    if (trimmed.length < 2) { setSimilarMatches([]); return; }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/inventory/products/similar?name=${encodeURIComponent(trimmed)}&exclude_id=${product.id}`, { signal: controller.signal })
        .then(r => r.json())
        .then(d => setSimilarMatches(d.matches || []))
        .catch(() => {});
    }, 300);
    return () => { clearTimeout(t); controller.abort(); };
  }, [mode, name, product.id]);
```

- [ ] **Step 3: Render warning panel above the approve form**

In the `DraftReviewPanel` render, find the `{mode === 'approve' && (`
block (added in Task 7 Step 3). Insert the warning panel right after
the opening `<div className="space-y-2">`, before the name input:

```tsx
          {similarMatches.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-300">
              <div className="flex items-start gap-2 mb-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p className="text-[12px] font-semibold text-amber-800">
                  {similarMatches.length} similar product{similarMatches.length !== 1 ? 's' : ''} already exist. Duplicate?
                </p>
              </div>
              <div className="flex flex-col gap-1">
                {similarMatches.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => handleLink(m)}
                    disabled={submitting}
                    className="text-left px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 text-[13px] active:bg-amber-50 disabled:opacity-50"
                  >
                    <span className="font-semibold text-gray-900">{m.name}</span>
                    <span className="text-gray-500 text-[11px] ml-2">{m.categ_id?.[1] || ''}</span>
                    <span className="text-amber-700 text-[11px] ml-2 font-semibold">Link to this →</span>
                  </button>
                ))}
              </div>
            </div>
          )}
```

One-tap "Link to this" shortcut — clicks reuse the existing
`handleLink(target)` function from Task 7.

- [ ] **Step 4: Build check**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/inventory/products/similar/route.ts \
        src/components/inventory/ReviewSubmissions.tsx
git commit -m "[ADD] inventory: warn manager about similar products during draft approve"
```

---

## Task 9: Manual verification

No automated tests exist — verify manually per CLAUDE.md convention.

- [ ] **Step 1: Start dev server**

```bash
cd /Users/ethan/Odoo_Portal_18EE && npm run dev
```

Open http://localhost:3000, log in as staff (Hana Kim — see CLAUDE.md).

- [ ] **Step 2: Simulate a barcode scan of an unknown value**

Since the real BT scanner isn't available yet, simulate via browser
console while Quick Count is open. In DevTools:

```javascript
// Simulate a BT HID scanner firing keystrokes. The hook listens on
// `window` with capture phase, so dispatch on window directly.
['9', '9', '9', '9', '8', '8', '8', '8', 'Enter'].forEach((k, i) => {
  setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }, i * 20);
});
```

Expected: BarcodeScanner overlay opens, shows "Looking up..." briefly,
then the UnknownBarcodeSheet with the barcode 99998888 displayed.

- [ ] **Step 3: Create draft product**

Type "Test Pork Belly", qty 2, tap "Create and count". Expected: toast
confirms, sheet closes, scanner ready. Close scanner and confirm the
count appears in the Quick Count product list with qty 2.

- [ ] **Step 4: Rescan same barcode**

Simulate the same barcode keystrokes again. Expected: "found" card with
"Test Pork Belly", amber "Pending review" badge, qty prefilled to 3
(2 + 1). Confirm → qty updates to 3.

- [ ] **Step 5: Submit**

Submit the quick count. Log in as Marco Bauer (manager). Open Review
submissions → find the submission. The pending product row should show
an amber "Pending product" pill with a three-button panel below.

- [ ] **Step 6: Exercise all three review actions**

On three separate draft products:
- Approve as new → set category (e.g. "All / Saleable"), UOM "Units", approve
- Link to existing → search "chicken" (or any existing product), select → barcode transfers
- Reject → confirm reject → row drops

- [ ] **Step 7: Approve the submission**

The submission-level approve should unlock once all drafts are resolved.
Approve → count lines should write to Odoo inventory adjustment as
normal.

- [ ] **Step 8: Verify in Odoo**

Log in to http://89.167.124.0:15069 as biz@krawings.de. Check:
- The approved draft appears as an active product with barcode
- The linked product now has the new barcode on its template
- The rejected draft stays archived

- [ ] **Step 9: Commit verification notes**

Write what you verified in the commit message of a small doc update (or
just note in the PR description when opening the PR — no commit
required here if no files changed).

---

## Task 10: Deploy & final verification

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/inventory-scan-to-count-unknown
```

- [ ] **Step 2: SSH to staging and deploy**

```bash
ssh root@89.167.124.0 "cd /opt/krawings-portal && git fetch && \
  git checkout feat/inventory-scan-to-count-unknown && git pull && \
  npm run build && test -f .next/BUILD_ID && systemctl restart krawings-portal"
```

Expected: build succeeds (BUILD_ID present), service restarts.

- [ ] **Step 3: Browser smoke test**

Open http://89.167.124.0:3000 on phone. Pair a BT scanner in HID mode.
Walk to storage. Scan any unknown item → create → submit → manager
approves. End-to-end works.

If no physical scanner yet: repeat Task 8 manual steps on the staging
URL. Hardware scanner integration is already proven via
useHardwareScanner — simulation with dispatched keydown events matches
real BT scanner behavior.

- [ ] **Step 4: Open PR or merge**

Per CLAUDE.md workflow, open a PR to main for review. If rolling direct,
merge locally and push to main.

---

## Rollback

Every task commits independently. Rollback one commit at a time:

```bash
git revert <commit_hash>
git push
```

To rollback the deployed version on staging:

```bash
ssh root@89.167.124.0 "cd /opt/krawings-portal && git checkout main && \
  git pull && npm run build && systemctl restart krawings-portal"
```

## Regression checklist

- [ ] Quick Count still works for known non-POS barcodes (no regression)
- [ ] CountingSession barcode scanning still works for non-POS products
- [ ] Normal review submission approval still works when no draft products involved
- [ ] Desktop-only views unaffected (no desktop CSS touched)
- [ ] No hardcoded `blue` — all new UI uses `#F5800A` per design guide

## Intended behavior changes (not regressions)

- [ ] Scanning a POS product's barcode now returns "unknown" instead of
  matching the POS product. Staff will see the new-product creation
  sheet. If they create a draft with that barcode, the API rejects with
  409 because the barcode already exists on the POS item. Tell the team
  POS items are not countable via this flow — they belong to the POS /
  recipe workflow.
- [ ] Quick Count product list no longer shows POS items.
