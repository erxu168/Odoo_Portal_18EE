# Product Shelf Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two shelf-life values per product (chilled days, frozen days) so the operator picks one at print time and the label reflects the chosen storage mode and expiry date.

**Architecture:** Two new fields on Odoo `product.template` are the source of truth. The portal reads and writes them via a new `/api/products/[id]/shelf-life` endpoint and a `Shelf Life` card on the BOM detail screen. The Package/Label flow gains a Chilled/Frozen toggle that recomputes the expiry date on every container; storage mode is persisted on the SQLite `container_splits` row so reprints stay consistent. The label rendering (preview + ZPL) gets a new `STORE:` line.

**Tech Stack:** Odoo 18 (Python addon), Next.js 14 + TypeScript (portal app), better-sqlite3 (portal DB), Tailwind CSS, Zebra ZPL.

**Spec:** [docs/superpowers/specs/2026-04-29-product-shelf-life-design.md](../specs/2026-04-29-product-shelf-life-design.md)

**Verification convention:** This codebase has no test framework. Each task ends with `npm run build` (must produce a fresh `.next/BUILD_ID` and exit 0) plus a manual smoke test on staging.

---

## File Map

### Odoo addon (separate workspace at `/opt/odoo/18.0/custom-addons/`)

- Create `krawings_shelf_life/__manifest__.py` — addon manifest
- Create `krawings_shelf_life/__init__.py` — Python package init
- Create `krawings_shelf_life/models/__init__.py` — models package init
- Create `krawings_shelf_life/models/product_template.py` — adds the two fields
- Create `krawings_shelf_life/views/product_template_views.xml` — adds the Shelf Life group on the product form

### Portal (this repo)

- Modify `src/lib/labeling-db.ts` — add `storage_mode` column to `container_splits` via try/catch ALTER TABLE; extend `ContainerSplit` insert/select helpers
- Modify `src/app/api/manufacturing-orders/[id]/route.ts` — fetch the two new fields from `product.template`; remove `expiration_time_days` from the response
- Modify `src/app/api/manufacturing-orders/[id]/package/route.ts` — accept `storage_mode` in POST body and store it on the split
- Create `src/app/api/products/[id]/shelf-life/route.ts` — GET (any authed user) + PATCH (manager+) for the two values
- Create `src/components/manufacturing/ShelfLifeCard.tsx` — the Shelf Life card used on BOM detail
- Modify `src/components/manufacturing/BomDetail.tsx` — render the ShelfLifeCard between recipe and instructions
- Modify `src/components/manufacturing/PackageLabel.tsx` — add storage mode toggle, recompute expiry on every container when toggled, post `storage_mode` on confirm, drop usage of `expiration_time_days`
- Modify `src/components/manufacturing/LabelPreview.tsx` — accept `storageMode` prop and render `STORE:` line; render blank `EXP:` cleanly
- Modify `src/lib/zpl.ts` — accept `storageMode` and render the `STORE:` line above `EXP:`; render `EXP:` with no value when expiry is empty
- Modify `src/types/labeling.ts` — extend `LabelData` with `storageMode: 'chilled' | 'frozen'`; extend `Container` with `storage_mode` (read-back)

---

## Stage 1 — Odoo addon

> These tasks happen in the Odoo workspace at `/opt/odoo/18.0/custom-addons/`. They are listed here for completeness; an agent working in the portal repo may need to flag the human to do these on the Odoo server, or do them in a separate session in that workspace.

### Task 1: Create addon skeleton

**Files:**
- Create: `/opt/odoo/18.0/custom-addons/krawings_shelf_life/__manifest__.py`
- Create: `/opt/odoo/18.0/custom-addons/krawings_shelf_life/__init__.py`
- Create: `/opt/odoo/18.0/custom-addons/krawings_shelf_life/models/__init__.py`

- [ ] **Step 1: Create the manifest**

Write `/opt/odoo/18.0/custom-addons/krawings_shelf_life/__manifest__.py`:

```python
{
    'name': 'Krawings Shelf Life',
    'version': '18.0.1.0.0',
    'summary': 'Per-product chilled and frozen shelf-life days for portal label printing.',
    'author': 'Krawings',
    'license': 'LGPL-3',
    'depends': ['product'],
    'data': [
        'views/product_template_views.xml',
    ],
    'installable': True,
    'application': False,
}
```

- [ ] **Step 2: Create the package init files**

Write `/opt/odoo/18.0/custom-addons/krawings_shelf_life/__init__.py`:

```python
from . import models
```

Write `/opt/odoo/18.0/custom-addons/krawings_shelf_life/models/__init__.py`:

```python
from . import product_template
```

- [ ] **Step 3: Commit (Odoo workspace)**

```bash
cd /opt/odoo/18.0/custom-addons
git add krawings_shelf_life/
git commit -m "[ADD] krawings_shelf_life: addon skeleton"
```

---

### Task 2: Add fields and view

**Files:**
- Create: `/opt/odoo/18.0/custom-addons/krawings_shelf_life/models/product_template.py`
- Create: `/opt/odoo/18.0/custom-addons/krawings_shelf_life/views/product_template_views.xml`

- [ ] **Step 1: Define the two fields**

Write `/opt/odoo/18.0/custom-addons/krawings_shelf_life/models/product_template.py`:

```python
from odoo import fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    x_shelf_life_chilled_days = fields.Integer(
        string='Shelf Life — Chilled (days)',
        default=0,
        help='Days the product lasts when stored chilled. 0 = not set; portal labels print without an expiry date.',
    )
    x_shelf_life_frozen_days = fields.Integer(
        string='Shelf Life — Frozen (days)',
        default=0,
        help='Days the product lasts when stored frozen. 0 = not set; portal labels print without an expiry date.',
    )
```

- [ ] **Step 2: Add the form view**

Write `/opt/odoo/18.0/custom-addons/krawings_shelf_life/views/product_template_views.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="product_template_shelf_life_form" model="ir.ui.view">
        <field name="name">product.template.shelf.life.form</field>
        <field name="model">product.template</field>
        <field name="inherit_id" ref="product.product_template_form_view"/>
        <field name="arch" type="xml">
            <xpath expr="//page[@name='inventory']" position="inside">
                <group string="Shelf Life (Krawings)" name="krawings_shelf_life">
                    <field name="x_shelf_life_chilled_days"/>
                    <field name="x_shelf_life_frozen_days"/>
                </group>
            </xpath>
        </field>
    </record>
</odoo>
```

- [ ] **Step 3: Commit (Odoo workspace)**

```bash
cd /opt/odoo/18.0/custom-addons
git add krawings_shelf_life/models/product_template.py krawings_shelf_life/views/product_template_views.xml
git commit -m "[ADD] krawings_shelf_life: chilled and frozen days fields with form view"
```

---

### Task 3: Install and verify on staging

**Files:** none (Odoo install + manual check)

- [ ] **Step 1: Restart Odoo and update apps list**

On the Odoo 18 staging server:

```bash
systemctl restart odoo-18
```

Then in Odoo: Apps → Update Apps List → search "Krawings Shelf Life" → Install.

- [ ] **Step 2: Verify the fields appear on a product**

In Odoo: Inventory → Products → open any product → click the Inventory tab → confirm a "Shelf Life (Krawings)" group is visible with two integer fields. Set one to `5` and one to `90`, save.

- [ ] **Step 3: Verify via JSON-RPC round trip**

From the portal server (or any host that can reach Odoo), run a one-shot Node script or `curl` against the JSON-RPC endpoint to read the two fields on the same product. Expected: `5` and `90`. Then write back `0`/`0` and re-read — expected `0`/`0`.

A minimal check from the portal repo:

```bash
node -e "
const { getOdoo } = require('./src/lib/odoo');
(async () => {
  const odoo = getOdoo();
  const r = await odoo.read('product.template', [<TMPL_ID>], ['x_shelf_life_chilled_days', 'x_shelf_life_frozen_days']);
  console.log(r);
})();
"
```

(Replace `<TMPL_ID>` with the id of the product you edited in Step 2.)

If this returns the expected values, Stage 1 is done.

---

## Stage 2 — Portal BOM editor + read/write API

### Task 4: Add GET endpoint for product shelf life

**Files:**
- Create: `src/app/api/products/[id]/shelf-life/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/products/[id]/shelf-life/route.ts`:

```typescript
/**
 * GET /api/products/[id]/shelf-life
 * Returns chilled_days and frozen_days for the given product.template id.
 *
 * PATCH /api/products/[id]/shelf-life
 * Updates one or both values. Manager+ only.
 */
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, hasRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tmplId = parseInt(params.id, 10);
  if (!Number.isFinite(tmplId) || tmplId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    const rows = await odoo.read('product.template', [tmplId], [
      'x_shelf_life_chilled_days',
      'x_shelf_life_frozen_days',
    ]);
    if (!rows.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({
      chilled_days: rows[0].x_shelf_life_chilled_days || 0,
      frozen_days: rows[0].x_shelf_life_frozen_days || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to read shelf life';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: exit 0, fresh `.next/BUILD_ID`.

- [ ] **Step 3: Smoke test**

Restart the portal locally (`npm run dev`) or deploy to staging, then:

```bash
curl -i -b "kw_session=<your_session>" http://localhost:3000/api/products/<TMPL_ID>/shelf-life
```

Expected: `200 { "chilled_days": 5, "frozen_days": 90 }` for the product you edited in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/products/[id]/shelf-life/route.ts
git commit -m "[ADD] portal: GET /api/products/[id]/shelf-life endpoint"
```

---

### Task 5: Add PATCH endpoint for product shelf life

**Files:**
- Modify: `src/app/api/products/[id]/shelf-life/route.ts`

- [ ] **Step 1: Append the PATCH handler**

Add to the bottom of `src/app/api/products/[id]/shelf-life/route.ts`:

```typescript
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'manager')) {
    return NextResponse.json({ error: 'Manager role required' }, { status: 403 });
  }

  const tmplId = parseInt(params.id, 10);
  if (!Number.isFinite(tmplId) || tmplId <= 0) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  let body: { chilled_days?: unknown; frozen_days?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: Record<string, number> = {};
  for (const key of ['chilled_days', 'frozen_days'] as const) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 999) {
      return NextResponse.json(
        { error: `${key} must be an integer between 0 and 999` },
        { status: 400 },
      );
    }
    update[key === 'chilled_days' ? 'x_shelf_life_chilled_days' : 'x_shelf_life_frozen_days'] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const odoo = getOdoo();
    await odoo.call('product.template', 'write', [[tmplId], update]);
    const rows = await odoo.read('product.template', [tmplId], [
      'x_shelf_life_chilled_days',
      'x_shelf_life_frozen_days',
    ]);
    return NextResponse.json({
      chilled_days: rows[0]?.x_shelf_life_chilled_days || 0,
      frozen_days: rows[0]?.x_shelf_life_frozen_days || 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update shelf life';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Smoke test as manager**

Log in as Marco Bauer (manager) in the staging portal, then:

```bash
curl -i -b "kw_session=<marco_session>" \
  -X PATCH http://localhost:3000/api/products/<TMPL_ID>/shelf-life \
  -H "Content-Type: application/json" \
  -d '{"chilled_days": 7, "frozen_days": 60}'
```

Expected: `200 { "chilled_days": 7, "frozen_days": 60 }`. Re-fetch with GET to confirm persistence. Open Odoo and verify the product form shows `7` and `60`.

- [ ] **Step 4: Smoke test as staff**

Log in as Hana Kim (staff), repeat the PATCH curl with her session.
Expected: `403 { "error": "Manager role required" }`.

- [ ] **Step 5: Smoke test validation**

```bash
curl -i -b "kw_session=<marco_session>" \
  -X PATCH http://localhost:3000/api/products/<TMPL_ID>/shelf-life \
  -H "Content-Type: application/json" \
  -d '{"chilled_days": -1}'
```

Expected: `400 { "error": "chilled_days must be an integer between 0 and 999" }`. No change in Odoo.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/products/[id]/shelf-life/route.ts
git commit -m "[ADD] portal: PATCH /api/products/[id]/shelf-life (manager+)"
```

---

### Task 6: Build the ShelfLifeCard component

**Files:**
- Create: `src/components/manufacturing/ShelfLifeCard.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/manufacturing/ShelfLifeCard.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';

interface ShelfLifeCardProps {
  productTmplId: number;
  canEdit: boolean; // parent (BomDetail) decides this from the user role
}

interface ShelfLifeValues {
  chilled_days: number;
  frozen_days: number;
}

export default function ShelfLifeCard({ productTmplId, canEdit }: ShelfLifeCardProps) {

  const [values, setValues] = useState<ShelfLifeValues | null>(null);
  const [chilledInput, setChilledInput] = useState('');
  const [frozenInput, setFrozenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/products/${productTmplId}/shelf-life`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Failed to load shelf life');
          return;
        }
        setValues(data);
        setChilledInput(data.chilled_days ? String(data.chilled_days) : '');
        setFrozenInput(data.frozen_days ? String(data.frozen_days) : '');
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load shelf life');
      }
    })();
    return () => { cancelled = true; };
  }, [productTmplId]);

  function parseDays(input: string): number | null {
    const trimmed = input.trim();
    if (trimmed === '') return 0;
    const n = parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 0 || n > 999 || String(n) !== trimmed) return null;
    return n;
  }

  async function handleSave() {
    const chilled = parseDays(chilledInput);
    const frozen = parseDays(frozenInput);
    if (chilled === null || frozen === null) {
      setError('Each value must be a whole number between 0 and 999.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productTmplId}/shelf-life`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chilled_days: chilled, frozen_days: frozen }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Save failed');
        return;
      }
      setValues(data);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!values) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
        <div className="text-sm text-gray-400">Loading shelf life...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
      <div className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-3">
        Shelf Life
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="text-[11px] font-bold tracking-wider uppercase text-gray-400 block mb-1">
            Chilled
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={chilledInput}
              onChange={e => setChilledInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
              className="w-20 h-12 px-3 border-[1.5px] border-gray-200 rounded-lg bg-gray-50 text-center text-base font-semibold focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/15 disabled:opacity-60"
            />
            <span className="text-sm text-gray-500">days</span>
          </div>
          {(parseDays(chilledInput) === 0) && (
            <div className="text-xs text-gray-400 mt-1">Not set — labels will print with no expiry date.</div>
          )}
        </div>

        <div className="flex-1">
          <label className="text-[11px] font-bold tracking-wider uppercase text-gray-400 block mb-1">
            Frozen
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={frozenInput}
              onChange={e => setFrozenInput(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="0"
              className="w-20 h-12 px-3 border-[1.5px] border-gray-200 rounded-lg bg-gray-50 text-center text-base font-semibold focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/15 disabled:opacity-60"
            />
            <span className="text-sm text-gray-500">days</span>
          </div>
          {(parseDays(frozenInput) === 0) && (
            <div className="text-xs text-gray-400 mt-1">Not set — labels will print with no expiry date.</div>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-3">
        Used to calculate the expiry date when printing labels.
      </div>

      {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

      {canEdit && (
        <div className="mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-orange-500 hover:bg-orange-600 active:scale-[0.97] text-white font-semibold rounded-full px-5 h-10 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save shelf life'}
          </button>
          {savedToast && (
            <span className="ml-3 text-sm text-green-600">Shelf life updated. New labels will use these values.</span>
          )}
        </div>
      )}
    </div>
  );
}
```

> **Note on the user role:** The portal does not have a client-side session hook today — components either fetch `/api/auth/me` themselves or get the role from a parent. Keeping it as a prop here means BomDetail (which already calls `/api/auth/me` for other reasons, or can be extended to) computes `canEdit` once and passes it down.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: exit 0. If the import path for the session hook is wrong, the build will fail — fix the import to match the actual hook used elsewhere (e.g. `import { useSession } from '@/lib/session'`), or accept `canEdit` as a prop.

- [ ] **Step 3: Commit**

```bash
git add src/components/manufacturing/ShelfLifeCard.tsx
git commit -m "[ADD] manufacturing: ShelfLifeCard component for BOM detail"
```

---

### Task 7: Embed the ShelfLifeCard in BomDetail

**Files:**
- Modify: `src/components/manufacturing/BomDetail.tsx`

- [ ] **Step 1: Identify the product template id used by BomDetail**

Open `src/components/manufacturing/BomDetail.tsx` and find where the BOM data exposes the product. The BOM has a `product_tmpl_id` field on the Odoo `mrp.bom` model — confirm it is on the BOM payload the page already fetches. If not, extend the BOM API route to include it (one-line addition to the field list).

- [ ] **Step 2: Get the user role in BomDetail**

Check whether BomDetail already loads the current user. If it does, capture `canEdit = user?.role === 'manager' || user?.role === 'admin'`. If not, add a small fetch at the top of the component:

```tsx
const [canEdit, setCanEdit] = useState(false);
useEffect(() => {
  fetch('/api/auth/me')
    .then(r => r.json())
    .then(d => setCanEdit(d.user?.role === 'manager' || d.user?.role === 'admin'))
    .catch(() => setCanEdit(false));
}, []);
```

(Use the actual auth endpoint the portal uses — search for `/api/auth/me` references to confirm the path.)

- [ ] **Step 3: Render the card**

In the JSX, between the recipe section and the instructions section, add:

```tsx
import ShelfLifeCard from '@/components/manufacturing/ShelfLifeCard';

// ...inside the render, where appropriate:
{bom?.product_tmpl_id?.[0] && (
  <ShelfLifeCard productTmplId={bom.product_tmpl_id[0]} canEdit={canEdit} />
)}
```

The exact placement depends on the existing layout — read the file first and pick the spot between recipe and instructions.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 5: Smoke test in browser**

Open a BOM detail page on staging.

- As Marco (manager): card appears, two inputs editable, Save button visible. Edit one value, save, confirm toast. Reload — values persist.
- As Hana (staff): card appears, inputs are disabled (greyed), Save button is hidden.
- Verify mobile (≤767.98px) — inputs stack vertically. Verify tablet/desktop — inputs side-by-side.
- For a BOM whose product has both values = 0: both "Not set — labels will print with no expiry date." hints appear under the inputs.

- [ ] **Step 6: Commit**

```bash
git add src/components/manufacturing/BomDetail.tsx
git commit -m "[ADD] manufacturing: render ShelfLifeCard on BOM detail"
```

---

### Task 8: Backfill window (no code)

**Files:** none

- [ ] **Step 1: Verify staging is fully deployed**

Confirm staging has the Odoo addon installed (Stage 1) and the BOM editor live (Tasks 4-7). The label flow is **unchanged** at this point and still uses the old `expiration_time` path.

- [ ] **Step 2: Hand off to the team**

Ethan + WAJ kitchen leads use the existing `expiration_time` value on each product as a reference and enter chilled + frozen days on every active BOM via the new card. Stage 3 should not ship until the team is ready.

---

## Stage 3 — Portal label flow flip

### Task 9: Add `storage_mode` column to `container_splits`

**Files:**
- Modify: `src/lib/labeling-db.ts`

- [ ] **Step 1: Add the ALTER TABLE migration**

Open `src/lib/labeling-db.ts`. Find the init function around line 21-138 (the place where existing `db.exec('ALTER TABLE …')` migrations live, following the pattern in [src/lib/db.ts:114](../../src/lib/db.ts#L114) and [src/lib/purchase-db.ts:157](../../src/lib/purchase-db.ts#L157)). Add inside the init function, after the existing CREATE TABLE statements:

```typescript
try {
  db.exec("ALTER TABLE container_splits ADD COLUMN storage_mode TEXT");
} catch (_e) {
  /* column already exists */
}
```

- [ ] **Step 2: Update the ContainerSplit type**

In the same file, find the `ContainerSplit` interface (or in `src/types/labeling.ts` around line 68 where `ContainerSplit` is defined). Add:

```typescript
storage_mode: 'chilled' | 'frozen' | null;
```

to the `ContainerSplit` interface.

- [ ] **Step 3: Update `createSplit` to accept and store storage_mode**

Find the `createSplit` (or equivalent insert) helper at around line 223 in `src/lib/labeling-db.ts`. Modify the INSERT to include the new column:

```typescript
INSERT INTO container_splits (
  mo_id, mo_name, product_id, product_name, total_qty, uom,
  status, created_by, created_at, storage_mode
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

And add `storage_mode` (a parameter on the function, type `'chilled' | 'frozen'`) to the parameter list and the `.run(...)` call.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: exit 0. TypeScript will flag any caller of `createSplit` that does not pass `storage_mode` — fix those in Task 10/11.

- [ ] **Step 5: Smoke test the migration**

Restart the dev server. Run:

```bash
sqlite3 <portal-db-path> "PRAGMA table_info(container_splits);"
```

Expected: a column named `storage_mode TEXT` is listed. Run the same command twice — the second run must not error (the try/catch handles the "column already exists" case).

- [ ] **Step 6: Commit**

```bash
git add src/lib/labeling-db.ts src/types/labeling.ts
git commit -m "[ADD] labeling-db: storage_mode column on container_splits"
```

---

### Task 10: Extend the manufacturing-orders endpoint

**Files:**
- Modify: `src/app/api/manufacturing-orders/[id]/route.ts`

- [ ] **Step 1: Read the new fields from product.template**

Open `src/app/api/manufacturing-orders/[id]/route.ts`. Locate line 133 where the existing `templates = await odoo.read('product.template', [tmplId], ['use_expiration_date', 'expiration_time'])` call lives, and the line 138 where `expirationTimeDays` is set, and line 194 where `expiration_time_days` is included in the response.

Replace those three locations as follows:

In the read call (line ~133), change the field list to:

```typescript
['x_shelf_life_chilled_days', 'x_shelf_life_frozen_days']
```

Replace the assignment around line 137-138:

```typescript
const shelfLifeChilledDays = templates[0]?.x_shelf_life_chilled_days || 0;
const shelfLifeFrozenDays  = templates[0]?.x_shelf_life_frozen_days  || 0;
```

Replace line 194 (the `expiration_time_days: expirationTimeDays,` field in the response) with:

```typescript
shelf_life_chilled_days: shelfLifeChilledDays,
shelf_life_frozen_days:  shelfLifeFrozenDays,
```

Also locate the second occurrence around line 268-271 (inside what looks like a per-component loop) and apply the same field rename — read `x_shelf_life_chilled_days`/`x_shelf_life_frozen_days` instead of `use_expiration_date`/`expiration_time`. The downstream usage at line 270-271 (`tmplData[0]?.use_expiration_date && tmplData[0]?.expiration_time`) should be removed entirely if its only purpose was the now-deleted expiry date path; if it has another use, replace the field references but keep the logic.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: exit 0. Any caller depending on `expiration_time_days` in the response will fail — that is intentional and is fixed in Task 11.

- [ ] **Step 3: Smoke test**

```bash
curl -s -b "kw_session=<session>" http://localhost:3000/api/manufacturing-orders/<MO_ID> | jq '.order | {shelf_life_chilled_days, shelf_life_frozen_days, expiration_time_days}'
```

Expected:

```json
{
  "shelf_life_chilled_days": 7,
  "shelf_life_frozen_days":  60,
  "expiration_time_days":    null
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/manufacturing-orders/[id]/route.ts
git commit -m "[REF] manufacturing-orders: return shelf_life_chilled_days and shelf_life_frozen_days"
```

---

### Task 11: Storage mode toggle in PackageLabel

**Files:**
- Modify: `src/components/manufacturing/PackageLabel.tsx`

- [ ] **Step 1: Replace the `shelfLifeDays` state with mode + per-mode days**

In `src/components/manufacturing/PackageLabel.tsx`, replace the lines around 60-62:

```typescript
// Shelf life from Odoo product settings (days)
const shelfLifeDays = mo?.expiration_time_days || 0;
const hasShelfLife = shelfLifeDays > 0;
```

with:

```typescript
const chilledDays: number = mo?.shelf_life_chilled_days || 0;
const frozenDays:  number = mo?.shelf_life_frozen_days  || 0;
const [storageMode, setStorageMode] = useState<'chilled' | 'frozen'>('chilled');
const activeShelfLifeDays = storageMode === 'chilled' ? chilledDays : frozenDays;
```

- [ ] **Step 2: Update `calcExpiryDate` to support a blank case**

Replace the existing helper at lines 27-35:

```typescript
/**
 * Calculate expiry date string (YYYY-MM-DD) from today + days.
 * Returns '' (empty) when shelfLifeDays is 0 — caller treats this as "no expiry".
 */
function calcExpiryDate(shelfLifeDays: number): string {
  if (!(shelfLifeDays > 0)) return '';
  const d = new Date();
  d.setDate(d.getDate() + shelfLifeDays);
  return d.toISOString().slice(0, 10);
}
```

The existing fallback "14 days when 0" is removed — per the spec, missing shelf life means a blank expiry on the label.

- [ ] **Step 3: Recompute every container's expiry when the mode changes**

Add an effect after the existing `useEffect` that loads the MO:

```typescript
useEffect(() => {
  // When storage mode changes, recompute expiry on every container row.
  // Only runs after the initial load (when mo is set).
  if (!mo) return;
  const newExpiry = calcExpiryDate(activeShelfLifeDays);
  setContainers(prev => prev.map(c => ({ ...c, expiryDate: newExpiry })));
}, [storageMode, mo]); // intentional: reruns when mode flips or MO loads
```

In the existing `addContainer` helper, change `calcExpiryDate(shelfLifeDays)` to `calcExpiryDate(activeShelfLifeDays)`. Same in the initial `setContainers` call inside the load effect.

- [ ] **Step 4: Add the toggle UI**

In the JSX of the `split` step (above the container rows), insert:

```tsx
<div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
  <div className="text-[11px] font-bold tracking-wider uppercase text-gray-400 mb-3">
    Storage
  </div>
  <div className="flex gap-2">
    {(['chilled', 'frozen'] as const).map(mode => {
      const days = mode === 'chilled' ? chilledDays : frozenDays;
      const isActive = storageMode === mode;
      return (
        <button
          key={mode}
          onClick={() => setStorageMode(mode)}
          className={`flex-1 h-16 rounded-xl border-2 font-semibold text-sm transition active:scale-[0.97] ${
            isActive
              ? 'bg-orange-50 border-orange-500 text-orange-600'
              : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          <div className="uppercase text-xs tracking-wider">{mode === 'chilled' ? 'Chilled' : 'Frozen'}</div>
          <div className="text-base mt-1">{days > 0 ? `${days} days` : '— days'}</div>
        </button>
      );
    })}
  </div>
  <div className="text-sm text-gray-500 mt-3">
    {activeShelfLifeDays > 0
      ? `Expiry: ${new Date(Date.now() + activeShelfLifeDays * 86400000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Expiry: not set — label will print without an expiry date.'}
  </div>
</div>
```

Place this above the container split rows in the `split` step's JSX.

- [ ] **Step 5: Drop the old "Shelf life: N days" hint line**

Find the existing line around 380:

```tsx
Shelf life: {shelfLifeDays} days &mdash; expiry auto-set to {fmtDate(calcExpiryDate(shelfLifeDays))}
```

Delete it. The new toggle UI replaces it.

- [ ] **Step 6: Allow blank expiry on confirm**

Find the `allFilled` check at line 132:

```typescript
const allFilled = containers.every(c => parseFloat(c.qty) > 0 && c.expiryDate);
```

Change to allow blank `expiryDate`:

```typescript
const allFilled = containers.every(c => parseFloat(c.qty) > 0);
```

- [ ] **Step 7: Send `storage_mode` in the confirm POST**

In `handleConfirmSplit`, find the body of the POST around line 152-156. Add `storage_mode: storageMode` to the body:

```typescript
body: JSON.stringify({
  mo_id: moId, mo_name: mo.name,
  product_id: mo.product_id[0], product_name: mo.product_id[1],
  total_qty: totalQty, uom,
  storage_mode: storageMode,
  containers: containers.map(c => ({ qty: parseFloat(c.qty), expiry_date: c.expiryDate || null })),
}),
```

Note: `expiry_date: c.expiryDate || null` ensures empty strings become null.

- [ ] **Step 8: Restore stored mode when loading an existing split**

In the load effect, where `existingSplit` is set (around line 95-105), after `setExistingSplit(splitData.split)`, add:

```typescript
if (splitData.split.storage_mode === 'frozen' || splitData.split.storage_mode === 'chilled') {
  setStorageMode(splitData.split.storage_mode);
}
// NULL (legacy splits before this migration) defaults to 'chilled' which is the initial state.
```

- [ ] **Step 9: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/components/manufacturing/PackageLabel.tsx
git commit -m "[ADD] PackageLabel: storage mode toggle + per-mode shelf life"
```

---

### Task 12: Persist storage_mode in the package POST endpoint

**Files:**
- Modify: `src/app/api/manufacturing-orders/[id]/package/route.ts`
- Modify: `src/lib/labeling-db.ts` (only if `createSplit` signature is in here — Task 9 already covered this)

- [ ] **Step 1: Read storage_mode from the POST body**

Open `src/app/api/manufacturing-orders/[id]/package/route.ts`. Find the POST handler. Where the body is parsed and validated, add:

```typescript
const storageMode = body.storage_mode;
if (storageMode !== 'chilled' && storageMode !== 'frozen') {
  return NextResponse.json({ error: 'storage_mode must be "chilled" or "frozen"' }, { status: 400 });
}
```

Pass `storageMode` to the `createSplit` (or whatever the helper is named) call.

- [ ] **Step 2: Return storage_mode in the GET response**

In the same file, find the GET handler that reads the existing split. Confirm the SELECT in `labeling-db.ts` reads all columns (`SELECT * FROM container_splits ...` already covers it — see line 201, 207). The response should already include `storage_mode` once the column exists. If the response is hand-shaped, explicitly include `storage_mode: split.storage_mode`.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Smoke test**

In the dev portal, go through Package flow on a fresh MO:

- Toggle to Frozen, confirm split.
- Reload. Verify the toggle is restored to Frozen.
- Run `sqlite3 <portal-db-path> "SELECT storage_mode FROM container_splits ORDER BY id DESC LIMIT 1;"` — expected: `frozen`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/manufacturing-orders/[id]/package/route.ts
git commit -m "[ADD] package endpoint: accept and persist storage_mode"
```

---

### Task 13: Render `STORE:` line in LabelPreview

**Files:**
- Modify: `src/components/manufacturing/LabelPreview.tsx`
- Modify: `src/types/labeling.ts`

- [ ] **Step 1: Extend the LabelData interface**

In `src/types/labeling.ts`, find the `LabelData` interface around line 129. Add:

```typescript
storageMode: 'chilled' | 'frozen';
```

Make it required (not optional) so every caller provides it.

- [ ] **Step 2: Update LabelPreview to render the line**

In `src/components/manufacturing/LabelPreview.tsx`, accept the new prop, then in the rendered block where the `Exp:` line lives (around line 117), render the `STORE:` line above it. Use the same font weight as the `Exp:` line. If `expiryDate` is empty/null, render `Exp:` with no value following.

Example pattern (adapt to the existing markup):

```tsx
<div className="font-bold">STORE: {storageMode.toUpperCase()}</div>
<div>Exp: {expiryDate || ''}</div>
```

- [ ] **Step 3: Pass `storageMode` from PackageLabel into LabelPreview**

In `src/components/manufacturing/PackageLabel.tsx`, find the LabelPreview render around line 459. Add `storageMode={storageMode}` to the props.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 5: Smoke test**

Open the package preview screen on staging:

- Chilled mode + values set: preview shows `STORE: CHILLED` and the calculated expiry date.
- Frozen mode + values set: preview shows `STORE: FROZEN`.
- Toggle to a mode whose value is 0: preview shows `STORE: <MODE>` and `Exp:` with no date after it.

- [ ] **Step 6: Commit**

```bash
git add src/types/labeling.ts src/components/manufacturing/LabelPreview.tsx src/components/manufacturing/PackageLabel.tsx
git commit -m "[ADD] LabelPreview: render STORE line above Exp"
```

---

### Task 14: Render `STORE:` line in the ZPL output

**Files:**
- Modify: `src/lib/zpl.ts`

- [ ] **Step 1: Read the existing layout**

Open `src/lib/zpl.ts`. The `generateZPL` function uses percentage-based line heights (title 9.3%, body 5.5%, qty 9%, **expiry 18% — biggest after title**, meta 3.5%). Locate the section that renders the expiry line — it uses the `exp` font and writes `EXP: <data.expiryDate>`.

- [ ] **Step 2: Add a STORE line above the EXP line**

Allocate a small portion of label height for the storage line (use the `body` font — 5.5% — since it is informational, not a primary read). Above the expiry block, push:

```typescript
// ── STORAGE MODE ──
const storeLabel = `STORE: ${data.storageMode.toUpperCase()}`;
lines.push(`^A0N,${body.h},${body.w}`);
lines.push(`^FO${margin},${y}^FB${printW},1,0,L^FD${escapeZPL(storeLabel)}^FS`);
y += body.h + gap;
```

Then the existing EXP block continues. If `data.expiryDate` is empty, render `EXP:` followed by no date — modify the existing EXP block so the empty case still produces a well-formed `^FD` (an empty `^FD` is valid ZPL):

```typescript
const expText = data.expiryDate ? `EXP: ${data.expiryDate}` : 'EXP:';
```

(Replace the variable used in the existing `^FO… ^FD${...}^FS` line with `expText`.)

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Smoke test ZPL output**

In the dev portal, on the package preview, click the "Copy ZPL" or equivalent button (or call the print API and capture the output). Confirm the ZPL contains:

```
^FDSTORE: CHILLED^FS
...
^FDEXP: 2026-05-04^FS
```

For the blank case:

```
^FDSTORE: FROZEN^FS
...
^FDEXP:^FS
```

- [ ] **Step 5: Print on a real Zebra**

In the WAJ kitchen (or any workstation paired with a Zebra), print one chilled label and one blank-expiry label. Verify visually:

- `STORE: CHILLED` line is legible (small but readable).
- `EXP: 04 May 2026` is the largest text on the label (per the existing 18% allocation).
- Blank case prints `EXP:` with no date — no garbage characters, no malformed barcode.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zpl.ts
git commit -m "[ADD] zpl: render STORE line and tolerate blank EXP"
```

---

### Task 15: End-to-end smoke test

**Files:** none

- [ ] **Step 1: Deploy to staging**

```bash
# on the portal server
cd /opt/krawings-portal
git pull
npm run build  # must exit 0; verify .next/BUILD_ID is fresh
systemctl restart krawings-portal
```

- [ ] **Step 2: Walk a happy-path scenario**

Pick a WAJ MO whose product has both chilled and frozen days set (e.g. 5 / 90).

- Open the MO → Package screen.
- Confirm toggle defaults to Chilled, expiry shown is today + 5 days.
- Switch to Frozen; expiry recomputes to today + 90 days, all container rows update.
- Confirm split.
- Print one container's label end-to-end.
- Verify the printed label shows `STORE: FROZEN` and the correct date.

- [ ] **Step 3: Walk a blank-expiry scenario**

Pick (or temporarily edit) a product so chilled = 0.

- Open Package screen, default toggle is Chilled.
- Toggle pill shows `— days`, expiry rows are blank.
- Confirm split — passes (no blocking).
- Print — label shows `STORE: CHILLED` and `EXP:` with no date.
- Re-edit the product on BOM detail to set chilled = 7. Open a fresh MO for the same product — Chilled now shows `7 days` and expiry is today + 7.

- [ ] **Step 4: Walk a reprint scenario**

Open a previously confirmed split (created in Step 2 with mode = Frozen).

- Toggle is restored to Frozen.
- Reprinting a container produces the same label as before.

- [ ] **Step 5: Walk a legacy split scenario**

Find a `container_splits` row created before this migration (`storage_mode IS NULL`).

- Open the MO → existing split renders with the toggle defaulting to Chilled (the safe default).
- Reprint a container — label shows `STORE: CHILLED` with the original expiry date (unchanged from when the split was confirmed).

- [ ] **Step 6: Tag the release**

```bash
git tag -a shelf-life-v1 -m "Product shelf life (chilled + frozen) launched"
git push --tags
```

---

## Spec coverage checklist

Cross-checking against [the spec](../specs/2026-04-29-product-shelf-life-design.md):

- [x] Component 1 (Odoo addon `krawings_shelf_life`, two `Integer` fields, form view) — Tasks 1-3
- [x] Component 2 read on MO endpoint — Task 10
- [x] Component 2 read+write endpoints (`/api/products/[id]/shelf-life`) — Tasks 4-5
- [x] Component 3 (BOM detail Shelf Life card, Manager+ edit, Staff read-only, hint when value = 0) — Tasks 6-7
- [x] Component 4 storage mode toggle (default Chilled, recompute on switch) — Task 11
- [x] Component 4 SQLite migration (`storage_mode` column) — Task 9
- [x] Component 4 persistence + reprint consistency — Tasks 11-12
- [x] Component 4 label rendering (LabelPreview + ZPL, STORE line, blank EXP) — Tasks 13-14
- [x] Behavior when shelf life is missing (never blocks, blank expiry) — Tasks 11, 13, 14
- [x] Migration of existing callers (drop `expiration_time_days`, drop 14-day fallback) — Tasks 10-11
- [x] Rollout in 3 stages (Odoo → BOM editor → label flow flip) — Stage 1, Stage 2, Stage 3 ordering
- [x] End-to-end smoke test on real Zebra — Tasks 14, 15
