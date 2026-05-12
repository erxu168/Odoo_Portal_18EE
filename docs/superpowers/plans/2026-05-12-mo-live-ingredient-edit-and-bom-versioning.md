# MO Live Ingredient Edit + BOM Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the chef adjust, add, and remove ingredients on an in-progress MO from the portal, then snapshot the result as a new linked BOM version with a label and notes.

**Architecture:** Two layers. Odoo (`krawings_recipe_config`) gains five fields on `mrp.bom` (version label, notes, parent, root, is_current) plus `action_save_as_new_bom_version` on `mrp.production`. The Next.js portal gains three new component-editing endpoints, three new versioning endpoints, plus four new components: `EditComponentSheet`, `AddIngredientSheet`, `SaveAsVersionModal`, `RecipeHistory`. The portal's `MoDetail.tsx` is the primary integration point.

**Tech Stack:** Odoo 18 EE (Python 3.10), Next.js 14 (App Router) + TypeScript, Tailwind, JSON-RPC via `src/lib/odoo.ts`.

**Spec:** [docs/superpowers/specs/2026-05-12-mo-live-ingredient-edit-and-bom-versioning-design.md](../specs/2026-05-12-mo-live-ingredient-edit-and-bom-versioning-design.md)

**Verification convention:** This codebase has no automated test framework. Each task ends with a verification step — either `npm run build` (portal must exit 0) or an Odoo `-u krawings_recipe_config --stop-after-init` run (must finish without traceback) plus a targeted JSON-RPC or UI smoke test on staging.

**Branch policy:** Per `CLAUDE.md`, commit everything to `main`. Never create side branches.

---

## File Map

### Odoo backend (`odoo-modules/krawings_recipe_config/`)

- Modify `__manifest__.py` — bump version, add `post_init_hook`
- Modify `__init__.py` — import the new hook
- Create `hooks.py` — backfill `version_root_id` for existing BOMs
- Modify `models/__init__.py` — `from . import mrp_production`
- Modify `models/mrp_bom.py` — add 5 fields, 2 computes, 1 constraint
- Create `models/mrp_production.py` — `action_save_as_new_bom_version`
- Modify `views/mrp_bom_views.xml` — add Version group + history smart button

### Portal API (`src/app/api/`)

- Modify `manufacturing-orders/[id]/route.ts` — extend GET response with `move_id`, `planned_qty`, `can_edit`
- Create `manufacturing-orders/[id]/components/route.ts` — `POST` add ingredient
- Create `manufacturing-orders/[id]/components/[moveId]/route.ts` — `PATCH` qty, `DELETE` line
- Create `manufacturing-orders/[id]/save-as-version/route.ts` — `POST` snapshot
- Create `boms/[id]/versions/route.ts` — `GET` version chain
- Create `boms/[id]/set-current/route.ts` — `POST` flip current

### Portal frontend (`src/components/manufacturing/`)

- Create `EditComponentSheet.tsx` — bottom sheet for qty edit + remove
- Create `AddIngredientSheet.tsx` — product picker bottom sheet
- Create `SaveAsVersionModal.tsx` — label/notes/current toggle modal
- Create `RecipeHistory.tsx` — version history screen
- Modify `MoDetail.tsx` — wire in edit sheet, add-ingredient button, save-as-version button
- Modify `BomDetail.tsx` — add "History" smart button

---

## Stage 1 — Odoo backend

> These tasks live in `odoo-modules/krawings_recipe_config/` inside this repo. Deploy by pulling on staging and running `-u krawings_recipe_config`.

### Task 1: Add the new fields to `mrp.bom`

**Files:**
- Modify: `odoo-modules/krawings_recipe_config/models/mrp_bom.py`

- [ ] **Step 1: Open the current file**

Confirm contents match what's in the spec — class `MrpBom(models.Model)` with `_inherit = 'mrp.bom'` and existing `x_*` recipe-guide fields.

- [ ] **Step 2: Add five new fields and two computes**

Append to the class body in `odoo-modules/krawings_recipe_config/models/mrp_bom.py` (after the existing `_compute_recipe_step_count` method):

```python
    version_label = fields.Char(
        string='Version',
        default='v.1',
        tracking=True,
        copy=False,
        help='Free-form label for this BOM version (e.g. "v.3", "v.3 — lime"). Suggested but not enforced.',
    )
    version_notes = fields.Text(
        string='Version Notes',
        copy=False,
        help="What changed in this version and why.",
    )
    version_parent_id = fields.Many2one(
        'mrp.bom',
        string='Derived From',
        ondelete='restrict',
        index=True,
        copy=False,
        help='The BOM version this one was derived from.',
    )
    version_root_id = fields.Many2one(
        'mrp.bom',
        string='Recipe Root',
        compute='_compute_version_root_id',
        store=True,
        index=True,
        recursive=True,
        help='The first version in this recipe chain (root of the version tree).',
    )
    is_current_version = fields.Boolean(
        string='Current Version',
        default=True,
        index=True,
        copy=False,
        help='Marks this BOM as the default for new MOs of its product. Exactly one BOM per recipe chain may be current.',
    )
    version_count = fields.Integer(
        string='Version Count',
        compute='_compute_version_count',
    )

    @api.depends('version_parent_id', 'version_parent_id.version_root_id')
    def _compute_version_root_id(self):
        for bom in self:
            bom.version_root_id = bom.version_parent_id.version_root_id or bom

    def _compute_version_count(self):
        # Walk by each BOM's root, not by self.ids — self contains
        # arbitrary versions in the chain, and we want the total count
        # of BOMs sharing each one's root.
        root_ids = list({bom.version_root_id.id for bom in self if bom.version_root_id})
        counts = {}
        if root_ids:
            grouped = self.env['mrp.bom'].read_group(
                [('version_root_id', 'in', root_ids)],
                ['version_root_id'],
                ['version_root_id'],
            )
            counts = {g['version_root_id'][0]: g['version_root_id_count'] for g in grouped}
        for bom in self:
            bom.version_count = counts.get(bom.version_root_id.id, 1)
```

Make sure `api` is imported at the top of the file:

```python
from odoo import models, fields, api
```

- [ ] **Step 3: Add the at-most-one-current constraint**

Append below the new methods:

```python
    @api.constrains('is_current_version', 'version_root_id')
    def _check_single_current_version(self):
        for bom in self:
            if not bom.is_current_version:
                continue
            others = self.env['mrp.bom'].search([
                ('id', '!=', bom.id),
                ('version_root_id', '=', bom.version_root_id.id),
                ('is_current_version', '=', True),
            ], limit=1)
            if others:
                raise models.ValidationError(
                    f"Another version of this recipe is already marked as current "
                    f"({others.version_label}). Unmark it before marking this one."
                )
```

Add the import for `ValidationError` near the top if not already present — replace the existing odoo import line with:

```python
from odoo import models, fields, api
from odoo.exceptions import ValidationError
```

And use `ValidationError` instead of `models.ValidationError` in the constraint above.

- [ ] **Step 4: Commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git add odoo-modules/krawings_recipe_config/models/mrp_bom.py
git commit -m "[ADD] krawings_recipe_config: version fields on mrp.bom"
```

---

### Task 2: Add the `action_save_as_new_bom_version` method

**Files:**
- Create: `odoo-modules/krawings_recipe_config/models/mrp_production.py`
- Modify: `odoo-modules/krawings_recipe_config/models/__init__.py`

- [ ] **Step 1: Create the new file**

Write `odoo-modules/krawings_recipe_config/models/mrp_production.py`:

```python
from odoo import models, fields, api
from odoo.exceptions import UserError


class MrpProduction(models.Model):
    _inherit = 'mrp.production'

    def action_save_as_new_bom_version(self, version_label, version_notes='',
                                        make_current=True):
        """Snapshot this MO's current raw moves as a new BOM version
        linked to self.bom_id as parent. Returns a dict describing the
        new BOM."""
        self.ensure_one()

        if not self.bom_id:
            raise UserError("This batch is not linked to a recipe. Save-as-version requires a source BOM.")
        if self.state not in ('draft', 'confirmed', 'progress', 'to_close'):
            raise UserError(f"Cannot save a new version from an MO in state '{self.state}'.")
        if not version_label or not version_label.strip():
            raise UserError("Version label is required.")

        source_bom = self.bom_id

        # Collect line specs from the current (non-cancelled) raw moves.
        raw_moves = self.move_raw_ids.filtered(lambda m: m.state != 'cancel')
        if not raw_moves:
            raise UserError("Cannot save a version with no ingredients.")

        line_vals = []
        for move in raw_moves:
            line_vals.append((0, 0, {
                'product_id': move.product_id.id,
                'product_qty': move.product_uom_qty,
                'product_uom_id': move.product_uom.id,
            }))

        # Copy the source BOM; copy=False fields (version_*, is_current_version)
        # start clean and we set them explicitly below.
        new_bom = source_bom.copy({
            'product_qty': self.qty_producing or self.product_qty or source_bom.product_qty,
            'bom_line_ids': [(5, 0, 0)] + line_vals,
            'version_label': version_label.strip(),
            'version_notes': (version_notes or '').strip(),
            'version_parent_id': source_bom.id,
        })

        # The compute on version_root_id picks up source_bom.version_root_id
        # automatically because we set version_parent_id during copy.

        # Handle is_current_version after creation, ordered to satisfy
        # the at-most-one constraint.
        new_bom.is_current_version = False  # copy=False already left it False; explicit for clarity
        if make_current:
            prior_current = self.env['mrp.bom'].search([
                ('version_root_id', '=', new_bom.version_root_id.id),
                ('is_current_version', '=', True),
                ('id', '!=', new_bom.id),
            ])
            if prior_current:
                prior_current.is_current_version = False
            new_bom.is_current_version = True

        return {
            'bom_id': new_bom.id,
            'version_label': new_bom.version_label,
            'version_count': new_bom.version_count,
            'is_current_version': new_bom.is_current_version,
        }
```

- [ ] **Step 2: Register the model in `__init__.py`**

Edit `odoo-modules/krawings_recipe_config/models/__init__.py`. Add the new import. The file should now look like (preserve existing imports, add `mrp_production`):

```python
from . import recipe_category
from . import recipe_recording
from . import recipe_step
from . import recipe_step_image
from . import recipe_step_ingredient
from . import recipe_version
from . import product_template
from . import mrp_bom
from . import mrp_production
```

(Use `git diff` after the edit to confirm only one line was added.)

- [ ] **Step 3: Commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git add odoo-modules/krawings_recipe_config/models/mrp_production.py \
        odoo-modules/krawings_recipe_config/models/__init__.py
git commit -m "[ADD] krawings_recipe_config: action_save_as_new_bom_version"
```

---

### Task 3: Add the post-init hook that backfills `version_root_id`

**Files:**
- Create: `odoo-modules/krawings_recipe_config/hooks.py`
- Modify: `odoo-modules/krawings_recipe_config/__init__.py`
- Modify: `odoo-modules/krawings_recipe_config/__manifest__.py`

- [ ] **Step 1: Write the hook**

Create `odoo-modules/krawings_recipe_config/hooks.py`:

```python
import logging

_logger = logging.getLogger(__name__)


def post_init_backfill_version_root(env):
    """For every existing mrp.bom with no version_root_id, set it to
    its own id. Each existing BOM becomes the root of its own
    one-version chain. Safe to re-run."""
    env.cr.execute("""
        UPDATE mrp_bom
           SET version_root_id = id
         WHERE version_root_id IS NULL
    """)
    n = env.cr.rowcount
    _logger.info("krawings_recipe_config: backfilled version_root_id for %s BOM(s)", n)
```

Note: Odoo 18 hooks receive an `env` directly (the older `cr, registry` signature was replaced).

- [ ] **Step 2: Re-export the hook from the package**

Edit `odoo-modules/krawings_recipe_config/__init__.py`. After existing imports, add:

```python
from . import models
from .hooks import post_init_backfill_version_root
```

(Add the second line only; leave existing `from . import models` if it's there.)

- [ ] **Step 3: Wire the hook into the manifest and bump the version**

Edit `odoo-modules/krawings_recipe_config/__manifest__.py`:

- Bump `'version': '18.0.2.0.0'` → `'18.0.3.0.0'`.
- Add `'post_init_hook': 'post_init_backfill_version_root',` to the dict (anywhere outside `data`).

Final manifest should look like:

```python
{
    'name': 'Krawings Recipe Config',
    'version': '18.0.3.0.0',
    'category': 'Manufacturing',
    'summary': 'Recipe Guide data layer + BOM versioning for Krawings Portal PWA',
    'description': """
        Adds recipe guide fields and BOM ingredient-version chaining to
        support the Krawings Portal Manufacturing module.
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['product', 'mrp', 'stock'],
    'data': [
        'security/ir.model.access.csv',
        'views/recipe_category_views.xml',
        'views/recipe_step_views.xml',
        'views/product_template_views.xml',
        'views/mrp_bom_views.xml',
        'views/menu.xml',
    ],
    'post_init_hook': 'post_init_backfill_version_root',
    'installable': True,
    'application': False,
    'auto_install': False,
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git add odoo-modules/krawings_recipe_config/hooks.py \
        odoo-modules/krawings_recipe_config/__init__.py \
        odoo-modules/krawings_recipe_config/__manifest__.py
git commit -m "[ADD] krawings_recipe_config: post_init backfill for version_root_id"
```

---

### Task 4: Add Version group + history smart button to the BOM form

**Files:**
- Modify: `odoo-modules/krawings_recipe_config/views/mrp_bom_views.xml`

- [ ] **Step 1: Inspect the current view file**

Read `odoo-modules/krawings_recipe_config/views/mrp_bom_views.xml`. Note the root XML record id that inherits `mrp.mrp_bom_form_view` and its existing xpaths.

- [ ] **Step 2: Append a new xpath that adds the Version group**

Inside the existing `<field name="arch" type="xml">` block, add a new `<xpath>` element that places a group at the top of the BOM form's sheet. Use `position="inside"` on a stable anchor. If the file already uses `<xpath expr="//sheet" position="inside">`, append a new group; otherwise add a fresh xpath. Example block to add:

```xml
<xpath expr="//field[@name='product_tmpl_id']" position="after">
    <group string="Version" name="krawings_version_group">
        <field name="version_label"/>
        <field name="is_current_version"/>
        <field name="version_parent_id" readonly="1"
               attrs="{'invisible': [('version_parent_id', '=', False)]}"/>
        <field name="version_root_id" readonly="1" groups="base.group_no_one"/>
        <field name="version_notes" nolabel="1" placeholder="What changed and why?" colspan="2"/>
    </group>
</xpath>
```

And the smart button (append inside the existing `<div name="button_box">` xpath, or add a new xpath targeting `button_box`):

```xml
<xpath expr="//div[@name='button_box']" position="inside">
    <button class="oe_stat_button" type="object"
            name="action_view_recipe_versions"
            icon="fa-history"
            attrs="{'invisible': [('version_count', '&lt;=', 1)]}">
        <field name="version_count" widget="statinfo" string="Versions"/>
    </button>
</xpath>
```

- [ ] **Step 3: Add the `action_view_recipe_versions` button handler on `mrp.bom`**

Append to `odoo-modules/krawings_recipe_config/models/mrp_bom.py`, inside the `MrpBom` class:

```python
    def action_view_recipe_versions(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Versions of {self.product_tmpl_id.display_name}',
            'res_model': 'mrp.bom',
            'view_mode': 'tree,form',
            'domain': [('version_root_id', '=', self.version_root_id.id)],
            'context': {'default_version_root_id': self.version_root_id.id},
        }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git add odoo-modules/krawings_recipe_config/views/mrp_bom_views.xml \
        odoo-modules/krawings_recipe_config/models/mrp_bom.py
git commit -m "[ADD] krawings_recipe_config: version group and history smart button on BOM form"
```

---

### Task 5: Deploy the Odoo module update and verify

**Files:** (no edits — deploy + smoke)

- [ ] **Step 1: Push to GitHub**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git push origin main
```

- [ ] **Step 2: Pull on staging and update the module**

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only'
ssh root@89.167.124.0 \
  '/opt/odoo/18.0/odoo-18.0/venv/bin/python3 /opt/odoo/18.0/odoo-18.0/odoo-bin \
   -c /opt/odoo/18.0/odoo-18.0/odoo.conf -d krawings \
   -u krawings_recipe_config --stop-after-init'
```

Expected: command exits 0 with a final log line like `Modules loaded.` No traceback. The post-init hook should log `krawings_recipe_config: backfilled version_root_id for N BOM(s)` where N is the existing BOM count.

- [ ] **Step 3: Restart Odoo**

```bash
ssh root@89.167.124.0 'systemctl restart odoo-18'
```

- [ ] **Step 4: Smoke-test the new fields via psql**

```bash
ssh root@89.167.124.0 'sudo -u postgres psql -d krawings -c \
  "SELECT id, version_label, is_current_version, version_root_id FROM mrp_bom LIMIT 5;"'
```

Expected: every row shows `version_label = 'v.1'`, `is_current_version = t`, `version_root_id = id`.

- [ ] **Step 5: Smoke-test the action via Odoo RPC**

Pick a real What a Jerk MO id (e.g. one from the portal MO list). Replace `<MO_ID>` below.

```bash
ssh root@89.167.124.0 'sudo -u postgres psql -d krawings -c \
  "SELECT id, name, state, bom_id FROM mrp_production \
   WHERE company_id = 5 AND state IN ('confirmed', 'progress') LIMIT 3;"'
```

Pick one with a non-null `bom_id`. Then in Odoo web UI at `http://89.167.124.0:15069/odoo` (forwarded), open Manufacturing → Bills of Materials → that BOM. Confirm the "Version" group is visible with `version_label = v.1`.

---

## Stage 2 — Portal API: component editing

### Task 6: Extend MO GET response with edit metadata

**Files:**
- Modify: `src/app/api/manufacturing-orders/[id]/route.ts`

- [ ] **Step 1: Find the components-building section of the GET handler**

In `src/app/api/manufacturing-orders/[id]/route.ts`, locate where the response builds the `components` array. It reads `stock.move` records associated with the MO via `move_raw_ids`. Currently it returns at minimum `product_id`, `product_uom`, `product_uom_qty`, and `quantity` (consumed).

- [ ] **Step 2: Extend the move read with three more fields and compute can_edit**

In the move read call, add `state` and any other already-read fields to the `fields` list — confirm `state` is included. Then when shaping the response components, add three new properties to each component object. Pseudocode pattern:

```typescript
const components = rawMoves.map((m: any) => ({
  ...existingFields,
  move_id: m.id,
  planned_qty: m.product_uom_qty,
  can_edit: ['draft', 'confirmed', 'progress'].includes(m.state) &&
            (m.quantity ?? m.qty_done ?? 0) === 0,
}));
```

Apply this inside the existing handler. If `quantity` is not currently read, add it to the `fields` list of the `odoo.read('stock.move', ...)` call.

Also extend the order-level response with two new flags so the frontend can render Save-as-version:

```typescript
order: {
  ...existingFields,
  can_edit_components: ['draft', 'confirmed', 'progress'].includes(order.state),
  can_save_version: ['draft', 'confirmed', 'progress', 'to_close'].includes(order.state) && !!order.bom_id,
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

Expected: build completes, no TypeScript errors. A fresh `.next/BUILD_ID` exists.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/manufacturing-orders/\[id\]/route.ts
git commit -m "feat(api): expose move_id, planned_qty, can_edit on MO components"
```

---

### Task 7: POST endpoint to add a new ingredient line

**Files:**
- Create: `src/app/api/manufacturing-orders/[id]/components/route.ts`

- [ ] **Step 1: Create the route file**

Write `src/app/api/manufacturing-orders/[id]/components/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

const EDITABLE_STATES = ['draft', 'confirmed', 'progress'];

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const moId = Number(params.id);
  if (!Number.isInteger(moId)) {
    return NextResponse.json({ error: 'Invalid MO id' }, { status: 400 });
  }

  let body: { product_id?: number; qty?: number; uom_id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const productId = Number(body.product_id);
  const qty = Number(body.qty);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'qty must be a positive number' }, { status: 400 });
  }

  const odoo = getOdoo();

  // Load MO + production location.
  const mos = await odoo.read('mrp.production', [moId], [
    'id', 'name', 'state', 'location_src_id', 'production_location_id', 'company_id',
  ]);
  if (!mos.length) {
    return NextResponse.json({ error: 'MO not found' }, { status: 404 });
  }
  const mo = mos[0];
  if (!EDITABLE_STATES.includes(mo.state)) {
    return NextResponse.json(
      { error: `MO state '${mo.state}' is not editable.` },
      { status: 409 },
    );
  }

  // Determine uom: explicit override or product default.
  let uomId = Number(body.uom_id) || 0;
  if (!uomId) {
    const prods = await odoo.read('product.product', [productId], ['uom_id', 'display_name']);
    if (!prods.length) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    uomId = prods[0].uom_id?.[0];
  }
  if (!uomId) {
    return NextResponse.json({ error: 'Could not resolve unit of measure.' }, { status: 422 });
  }

  // Resolve product display name for the move 'name' field.
  const prods2 = await odoo.read('product.product', [productId], ['display_name']);
  const productName = prods2[0]?.display_name || `Product ${productId}`;

  // Create the raw-material move attached to this MO.
  const moveId = await odoo.create('stock.move', {
    name: productName,
    product_id: productId,
    product_uom_qty: qty,
    product_uom: uomId,
    raw_material_production_id: moId,
    location_id: mo.location_src_id?.[0],
    location_dest_id: mo.production_location_id?.[0],
    company_id: mo.company_id?.[0],
  });

  // Confirm the new move so it joins the MO's planned consumption.
  if (['confirmed', 'progress'].includes(mo.state)) {
    await odoo.call('stock.move', '_action_confirm', [[moveId]]);
  }

  return NextResponse.json({
    move_id: moveId,
    product_id: productId,
    product_name: productName,
    planned_qty: qty,
    uom_id: uomId,
  });
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/manufacturing-orders/\[id\]/components/route.ts
git commit -m "feat(api): POST /manufacturing-orders/:id/components — add ingredient"
```

---

### Task 8: PATCH and DELETE endpoints for a single component

**Files:**
- Create: `src/app/api/manufacturing-orders/[id]/components/[moveId]/route.ts`

- [ ] **Step 1: Create the route file**

Write `src/app/api/manufacturing-orders/[id]/components/[moveId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

const EDITABLE_STATES = ['draft', 'confirmed', 'progress'];

async function guardEditableMove(odoo: ReturnType<typeof getOdoo>, moId: number, moveId: number) {
  const mos = await odoo.read('mrp.production', [moId], ['id', 'state']);
  if (!mos.length) return { error: 'MO not found', status: 404 };
  if (!EDITABLE_STATES.includes(mos[0].state)) {
    return { error: `MO state '${mos[0].state}' is not editable.`, status: 409 };
  }
  const moves = await odoo.read('stock.move', [moveId], [
    'id', 'raw_material_production_id', 'state', 'quantity', 'product_uom',
  ]);
  if (!moves.length) return { error: 'Component not found', status: 404 };
  const m = moves[0];
  if ((m.raw_material_production_id?.[0]) !== moId) {
    return { error: 'Component does not belong to this MO', status: 409 };
  }
  if ((m.quantity ?? 0) > 0) {
    return { error: 'Component already partially consumed; cannot edit.', status: 409 };
  }
  return { move: m };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; moveId: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const moId = Number(params.id);
  const moveId = Number(params.moveId);
  if (!Number.isInteger(moId) || !Number.isInteger(moveId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  let body: { qty?: number };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'qty must be a positive number' }, { status: 400 });
  }

  const odoo = getOdoo();
  const guard = await guardEditableMove(odoo, moId, moveId);
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  await odoo.write('stock.move', [moveId], { product_uom_qty: qty });
  return NextResponse.json({ move_id: moveId, planned_qty: qty });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; moveId: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  const moId = Number(params.id);
  const moveId = Number(params.moveId);
  if (!Number.isInteger(moId) || !Number.isInteger(moveId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const odoo = getOdoo();
  const guard = await guardEditableMove(odoo, moId, moveId);
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Cancel the move instead of unlink — Odoo's manufacturing flow keeps
  // the move record around but in 'cancel' state, which doesn't show up
  // in the chef's UI (we filter to non-cancel in the GET handler).
  await odoo.call('stock.move', '_action_cancel', [[moveId]]);
  return NextResponse.json({ move_id: moveId, cancelled: true });
}
```

- [ ] **Step 2: Update the GET in Task 6 to exclude cancelled moves**

Re-open `src/app/api/manufacturing-orders/[id]/route.ts`. In the rawMoves filter (or in the read call's domain if using search_read), add a filter so cancelled moves are not returned to the client. Apply at the JS level after read:

```typescript
const rawMoves = (await odoo.read('stock.move', rawMoveIds, [...])).filter(
  (m: any) => m.state !== 'cancel',
);
```

- [ ] **Step 3: Build and commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/app/api/manufacturing-orders/\[id\]/components/\[moveId\]/route.ts \
        src/app/api/manufacturing-orders/\[id\]/route.ts
git commit -m "feat(api): PATCH/DELETE component on MO with editable guard"
```

---

## Stage 3 — Portal API: versioning

### Task 9: POST save-as-version

**Files:**
- Create: `src/app/api/manufacturing-orders/[id]/save-as-version/route.ts`

- [ ] **Step 1: Create the route**

Write `src/app/api/manufacturing-orders/[id]/save-as-version/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const moId = Number(params.id);
  if (!Number.isInteger(moId)) {
    return NextResponse.json({ error: 'Invalid MO id' }, { status: 400 });
  }

  let body: { version_label?: string; version_notes?: string; make_current?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const label = (body.version_label || '').trim();
  if (!label) {
    return NextResponse.json({ error: 'Version label is required.' }, { status: 400 });
  }
  if (label.length > 64) {
    return NextResponse.json({ error: 'Version label must be 64 characters or fewer.' }, { status: 400 });
  }
  const notes = (body.version_notes || '').trim();
  if (notes.length > 1000) {
    return NextResponse.json({ error: 'Notes must be 1000 characters or fewer.' }, { status: 400 });
  }
  const makeCurrent = body.make_current !== false;

  const odoo = getOdoo();
  try {
    const result = await odoo.call(
      'mrp.production',
      'action_save_as_new_bom_version',
      [[moId], label, notes, makeCurrent],
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save version.';
    // Odoo UserError surfaces as a JSON-RPC error with a debug stack;
    // strip the "odoo.exceptions.UserError: " prefix when present.
    const clean = message.replace(/.*UserError:\s*/, '').replace(/\\n.*/s, '');
    return NextResponse.json({ error: clean }, { status: 422 });
  }
}
```

- [ ] **Step 2: Build and commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/app/api/manufacturing-orders/\[id\]/save-as-version/route.ts
git commit -m "feat(api): POST save-as-version for MO"
```

---

### Task 10: GET BOM version history

**Files:**
- Create: `src/app/api/boms/[id]/versions/route.ts`

- [ ] **Step 1: Create the route**

Write `src/app/api/boms/[id]/versions/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const bomId = Number(params.id);
  if (!Number.isInteger(bomId)) {
    return NextResponse.json({ error: 'Invalid BOM id' }, { status: 400 });
  }

  const odoo = getOdoo();
  const seed = await odoo.read('mrp.bom', [bomId], ['version_root_id', 'product_tmpl_id']);
  if (!seed.length) {
    return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
  }
  const rootId = seed[0].version_root_id?.[0];
  if (!rootId) {
    return NextResponse.json({ error: 'BOM has no version root (run module update).' }, { status: 500 });
  }

  const versions = await odoo.searchRead(
    'mrp.bom',
    [['version_root_id', '=', rootId]],
    [
      'id', 'version_label', 'version_notes', 'version_parent_id',
      'is_current_version', 'create_date', 'create_uid', 'bom_line_ids',
    ],
    { order: 'create_date desc', limit: 200 },
  );

  return NextResponse.json({
    product_tmpl_id: seed[0].product_tmpl_id,
    versions: versions.map((v: any) => ({
      id: v.id,
      version_label: v.version_label,
      version_notes: v.version_notes,
      parent_id: v.version_parent_id?.[0] || null,
      is_current_version: v.is_current_version,
      created_at: v.create_date,
      created_by: v.create_uid?.[1] || null,
      line_count: (v.bom_line_ids || []).length,
    })),
  });
}
```

- [ ] **Step 2: Build and commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/app/api/boms/\[id\]/versions/route.ts
git commit -m "feat(api): GET /boms/:id/versions"
```

---

### Task 11: POST set-current

**Files:**
- Create: `src/app/api/boms/[id]/set-current/route.ts`

- [ ] **Step 1: Create the route**

Write `src/app/api/boms/[id]/set-current/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth();
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const bomId = Number(params.id);
  if (!Number.isInteger(bomId)) {
    return NextResponse.json({ error: 'Invalid BOM id' }, { status: 400 });
  }

  const odoo = getOdoo();
  const target = await odoo.read('mrp.bom', [bomId], ['version_root_id', 'is_current_version']);
  if (!target.length) {
    return NextResponse.json({ error: 'BOM not found' }, { status: 404 });
  }
  if (target[0].is_current_version) {
    return NextResponse.json({ bom_id: bomId, already_current: true });
  }
  const rootId = target[0].version_root_id?.[0];

  // Flip the previously-current one off first to keep the constraint happy.
  const priors = await odoo.searchRead(
    'mrp.bom',
    [
      ['version_root_id', '=', rootId],
      ['is_current_version', '=', true],
      ['id', '!=', bomId],
    ],
    ['id'],
  );
  if (priors.length) {
    await odoo.write('mrp.bom', priors.map((p: any) => p.id), { is_current_version: false });
  }
  await odoo.write('mrp.bom', [bomId], { is_current_version: true });
  return NextResponse.json({ bom_id: bomId, current: true });
}
```

- [ ] **Step 2: Build and commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/app/api/boms/\[id\]/set-current/route.ts
git commit -m "feat(api): POST /boms/:id/set-current"
```

---

### Task 12: Deploy the API layer and smoke-test end-to-end

**Files:** (deploy + smoke)

- [ ] **Step 1: Push and deploy the portal**

```bash
cd /Users/ethan/Odoo_Portal_18EE
git push origin main
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'
```

Expected: build succeeds on the server, service restarts cleanly.

- [ ] **Step 2: Smoke test via curl**

Use a test session cookie obtained from a portal login (or call directly while the server is on the local network). Replace `<MO_ID>` and `<COOKIE>` below. First, GET the MO and confirm new fields are present:

```bash
curl -s -H 'Cookie: <COOKIE>' \
  "http://89.167.124.0:3000/api/manufacturing-orders/<MO_ID>" | \
  jq '.order.components[0] | {move_id, planned_qty, can_edit}'
```

Expected: all three fields are populated.

Update a planned qty:

```bash
curl -s -X PATCH -H 'Cookie: <COOKIE>' -H 'Content-Type: application/json' \
  -d '{"qty": 999}' \
  "http://89.167.124.0:3000/api/manufacturing-orders/<MO_ID>/components/<MOVE_ID>"
```

Expected: `{"move_id": <MOVE_ID>, "planned_qty": 999}`. Re-GET the MO to confirm persistence.

Save as version:

```bash
curl -s -X POST -H 'Cookie: <COOKIE>' -H 'Content-Type: application/json' \
  -d '{"version_label":"v.2 — smoke","version_notes":"smoke test","make_current":false}' \
  "http://89.167.124.0:3000/api/manufacturing-orders/<MO_ID>/save-as-version"
```

Expected: response contains a new `bom_id` and `version_label = "v.2 — smoke"`.

GET versions:

```bash
curl -s -H 'Cookie: <COOKIE>' \
  "http://89.167.124.0:3000/api/boms/<NEW_BOM_ID>/versions" | jq '.versions[0]'
```

Expected: at least two versions in the chain, newest first.

- [ ] **Step 3: Clean up the smoke-test BOM (optional)**

If desired, delete the new BOM via psql:
```bash
ssh root@89.167.124.0 'sudo -u postgres psql -d krawings -c "DELETE FROM mrp_bom WHERE version_label = 'v.2 — smoke';"'
```

---

## Stage 4 — Portal frontend: edit components on MoDetail

### Task 13: `EditComponentSheet` — bottom sheet for qty edit + remove

**Files:**
- Create: `src/components/manufacturing/EditComponentSheet.tsx`

- [ ] **Step 1: Create the component**

Write `src/components/manufacturing/EditComponentSheet.tsx`:

```typescript
'use client';

import React, { useState } from 'react';

interface Component {
  move_id: number;
  product_id: [number, string];
  product_uom: [number, string];
  planned_qty: number;
}

interface EditComponentSheetProps {
  moId: number;
  component: Component;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditComponentSheet({
  moId, component, open, onClose, onSaved,
}: EditComponentSheetProps) {
  const [qty, setQty] = useState<string>(String(component.planned_qty));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSave() {
    setError(null);
    const value = Number(qty);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/components/${component.move_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qty: value }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove ${component.product_id[1]} from this batch?`)) return;
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/components/${component.move_id}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove');
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-7"
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-xs font-semibold uppercase text-gray-500">
          {component.product_uom[1]}
        </div>
        <h2 className="mb-4 text-lg font-bold">{component.product_id[1]}</h2>

        <label className="mb-1 block text-sm font-medium text-gray-700">Quantity</label>
        <input
          type="number"
          step="any"
          min="0"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-3 text-lg font-mono focus:border-orange-500 focus:outline-none"
          autoFocus
        />

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving || removing}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleRemove}
            disabled={saving || removing}
            className="w-full rounded-full border border-gray-300 px-4 py-3 font-semibold text-red-600 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove ingredient'}
          </button>
          <button
            onClick={onClose}
            disabled={saving || removing}
            className="w-full rounded-full px-4 py-3 font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/manufacturing/EditComponentSheet.tsx
git commit -m "feat(ui): EditComponentSheet for MO ingredient qty/remove"
```

---

### Task 14: `AddIngredientSheet` — product picker bottom sheet

**Files:**
- Create: `src/components/manufacturing/AddIngredientSheet.tsx`

- [ ] **Step 1: Check whether a products search endpoint exists**

```bash
ls /Users/ethan/Odoo_Portal_18EE/src/app/api/products 2>/dev/null
```

If no search route exists, expect to use Odoo `product.product` `name_search`. The sheet below assumes `/api/products?search=…` returns `{ items: [{id, display_name, uom_id}] }`. If that route does not exist, also create it in this task (using the snippet at the end of this task).

- [ ] **Step 2: Create the sheet component**

Write `src/components/manufacturing/AddIngredientSheet.tsx`:

```typescript
'use client';

import React, { useState, useEffect } from 'react';

interface AddIngredientSheetProps {
  moId: number;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

interface ProductHit {
  id: number;
  display_name: string;
  uom_id?: [number, string];
}

export default function AddIngredientSheet({
  moId, open, onClose, onAdded,
}: AddIngredientSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductHit[]>([]);
  const [picked, setPicked] = useState<ProductHit | null>(null);
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery(''); setResults([]); setPicked(null); setQty(''); setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!query || picked) { setResults([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(query)}`, {
          signal: ctl.signal,
        });
        const data = await res.json();
        setResults(data.items || []);
      } catch {
        // ignore aborts
      }
    }, 200);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [query, picked]);

  if (!open) return null;

  async function handleAdd() {
    setError(null);
    if (!picked) { setError('Pick an ingredient first.'); return; }
    const value = Number(qty);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Quantity must be a positive number.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: picked.id, qty: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add');
      onAdded();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-7"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Add ingredient</h2>

        {picked ? (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-orange-50 px-3 py-3">
            <div>
              <div className="font-semibold">{picked.display_name}</div>
              {picked.uom_id && (
                <div className="text-xs text-gray-500">{picked.uom_id[1]}</div>
              )}
            </div>
            <button
              onClick={() => setPicked(null)}
              className="text-sm text-orange-600 underline"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ingredient…"
              className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-orange-500 focus:outline-none"
              autoFocus
            />
            {results.length > 0 && (
              <ul className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
                {results.map((p) => (
                  <li
                    key={p.id}
                    onClick={() => setPicked(p)}
                    className="cursor-pointer border-b border-gray-100 px-3 py-3 last:border-b-0 hover:bg-orange-50"
                  >
                    <div className="font-medium">{p.display_name}</div>
                    {p.uom_id && <div className="text-xs text-gray-500">{p.uom_id[1]}</div>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {picked && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Quantity ({picked.uom_id?.[1] || 'units'})
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-3 text-lg font-mono focus:border-orange-500 focus:outline-none"
              autoFocus
            />
          </>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleAdd}
            disabled={saving || !picked}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add ingredient'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full rounded-full px-4 py-3 font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3 (conditional): Create `/api/products` if it doesn't already exist**

If `ls src/app/api/products` returned no file in Step 1, write `src/app/api/products/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { requireAuth, AuthError } from '@/lib/auth';

export async function GET(req: Request) {
  try { await requireAuth(); }
  catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get('search') || '').trim();
  if (!search) return NextResponse.json({ items: [] });

  const odoo = getOdoo();
  const items = await odoo.searchRead(
    'product.product',
    ['|', ['name', 'ilike', search], ['default_code', 'ilike', search]],
    ['id', 'display_name', 'uom_id'],
    { limit: 20, order: 'name asc' },
  );
  return NextResponse.json({ items });
}
```

If the route already exists, skip this step but verify the response shape matches `{ items: [{id, display_name, uom_id}] }`. If it doesn't, adjust the sheet to match the existing shape rather than creating a duplicate route.

- [ ] **Step 4: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/manufacturing/AddIngredientSheet.tsx
# Include products route only if it was created this task:
git add src/app/api/products/route.ts 2>/dev/null || true
git commit -m "feat(ui): AddIngredientSheet + /api/products search"
```

---

### Task 15: Wire edit + add into `MoDetail`

**Files:**
- Modify: `src/components/manufacturing/MoDetail.tsx`

- [ ] **Step 1: Add imports and state**

Near the top of the file (after existing imports), add:

```typescript
import EditComponentSheet from './EditComponentSheet';
import AddIngredientSheet from './AddIngredientSheet';
```

In the component body alongside other `useState` declarations, add:

```typescript
const [editingComponent, setEditingComponent] = useState<any | null>(null);
const [addOpen, setAddOpen] = useState(false);
```

- [ ] **Step 2: Make component rows tappable**

Find the JSX block that renders each component row in the components list. Wrap the row in a `<button>` (or add `onClick`) that opens the edit sheet when `c.can_edit` is true. A "consumed" badge appears when `can_edit` is false. Replace the existing row markup with the following pattern (adapt to the existing class names — don't break layout):

```tsx
{components.map((c) => (
  <div key={c.move_id}
       className={`flex items-center justify-between border-b border-gray-100 px-4 py-3 ${c.can_edit ? 'cursor-pointer active:bg-orange-50' : ''}`}
       onClick={() => c.can_edit && setEditingComponent(c)}>
    <div className="min-w-0 flex-1">
      <div className="text-xs text-gray-500 uppercase">{c.product_uom?.[1] || ''}</div>
      <div className="truncate font-semibold">{c.product_id?.[1]}</div>
    </div>
    <div className="ml-3 text-right">
      <div className="font-mono font-bold">{c.planned_qty}</div>
      {!c.can_edit && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          consumed
        </span>
      )}
    </div>
  </div>
))}
```

(Keep any existing pick-list checkbox markup — this snippet only shows the qty cell; merge with what already exists.)

- [ ] **Step 3: Add the "+ Add ingredient" button below the components list**

Immediately after the components-list closing tag, add:

```tsx
{mo?.can_edit_components && (
  <button
    onClick={() => setAddOpen(true)}
    className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-orange-300 px-4 py-3 font-medium text-orange-600 active:bg-orange-50"
  >
    + Add ingredient
  </button>
)}
```

- [ ] **Step 4: Mount the sheets at the bottom of the component's returned JSX**

Just before the outer closing tag of the component, add:

```tsx
{editingComponent && (
  <EditComponentSheet
    moId={moId}
    component={editingComponent}
    open={!!editingComponent}
    onClose={() => setEditingComponent(null)}
    onSaved={fetchDetail}
  />
)}
<AddIngredientSheet
  moId={moId}
  open={addOpen}
  onClose={() => setAddOpen(false)}
  onAdded={fetchDetail}
/>
```

- [ ] **Step 5: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

Expected: build succeeds. Fix any TS errors immediately (most likely: typing on `editingComponent` — relax to `any` if needed).

- [ ] **Step 6: Commit and deploy**

```bash
git add src/components/manufacturing/MoDetail.tsx
git commit -m "feat(ui): wire edit-component sheet and add-ingredient into MoDetail"
git push origin main
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'
```

- [ ] **Step 7: Manual smoke**

Open the portal Manufacturing tab on a phone (or http://89.167.124.0:3000 in browser). Open a What a Jerk MO in `confirmed` state. Tap a component → bottom sheet appears → change qty → save → row updates. Tap "+ Add ingredient" → search "salt" → pick → enter qty → add → new row appears in the list.

---

## Stage 5 — Portal frontend: SaveAsVersionModal

### Task 16: `SaveAsVersionModal`

**Files:**
- Create: `src/components/manufacturing/SaveAsVersionModal.tsx`

- [ ] **Step 1: Write the helper for label suggestion**

Inline within the component below. The rule: if source label matches `^v\\.(\\d+)`, suggest `v.<N+1>` keeping the rest. Otherwise suggest `${source} v.2`.

- [ ] **Step 2: Create the modal**

Write `src/components/manufacturing/SaveAsVersionModal.tsx`:

```typescript
'use client';

import React, { useState, useEffect } from 'react';

interface SaveAsVersionModalProps {
  moId: number;
  open: boolean;
  productName: string;
  sourceVersionLabel: string;
  onClose: () => void;
  onSaved: (result: { bom_id: number; version_label: string }) => void;
}

function suggestNextLabel(source: string): string {
  const m = source.match(/^v\.(\d+)(.*)$/i);
  if (m) {
    const next = Number(m[1]) + 1;
    return `v.${next}${m[2]}`;
  }
  return `${source || 'v.1'} v.2`;
}

export default function SaveAsVersionModal({
  moId, open, productName, sourceVersionLabel, onClose, onSaved,
}: SaveAsVersionModalProps) {
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel(suggestNextLabel(sourceVersionLabel || 'v.1'));
      setNotes('');
      setMakeCurrent(true);
      setError(null);
    }
  }, [open, sourceVersionLabel]);

  if (!open) return null;

  async function handleSave() {
    setError(null);
    if (!label.trim()) { setError('Version label is required.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}/save-as-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version_label: label.trim(),
          version_notes: notes.trim(),
          make_current: makeCurrent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({ bom_id: data.bom_id, version_label: data.version_label });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Save changes as a new version</h2>
        <p className="mt-1 text-sm text-gray-500">
          Source: <span className="font-medium">{productName}</span>
          {' '}— <span className="font-mono">{sourceVersionLabel}</span>
        </p>

        <label className="mt-4 mb-1 block text-sm font-medium text-gray-700">Version</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          className="w-full rounded-lg border border-gray-300 px-3 py-3 font-mono focus:border-orange-500 focus:outline-none"
        />

        <label className="mt-4 mb-1 block text-sm font-medium text-gray-700">What changed</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="More salt. Added lime juice. Punchier."
          className="w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-orange-500 focus:outline-none"
        />

        <label className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            checked={makeCurrent}
            onChange={(e) => setMakeCurrent(e.target.checked)}
            className="h-5 w-5 accent-orange-500"
          />
          <span className="text-sm text-gray-800">Use this as the default recipe for new batches</span>
        </label>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-full bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full rounded-full px-4 py-3 font-medium text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build and commit**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/components/manufacturing/SaveAsVersionModal.tsx
git commit -m "feat(ui): SaveAsVersionModal for snapshot from MO"
```

---

### Task 17: Wire `Save as new version` into MoDetail

**Files:**
- Modify: `src/components/manufacturing/MoDetail.tsx`
- Modify: `src/app/api/manufacturing-orders/[id]/route.ts` (return BOM label)

- [ ] **Step 1: Extend the GET response with `bom_version_label`**

In `src/app/api/manufacturing-orders/[id]/route.ts`, find where the order's `bom_id` is read. Extend that read to also fetch `version_label` on the BOM and surface it on the response order object as `bom_version_label`. Snippet to add (or merge into the existing read):

```typescript
let bomVersionLabel: string | null = null;
if (order.bom_id) {
  const boms = await odoo.read('mrp.bom', [order.bom_id[0]], ['version_label']);
  bomVersionLabel = boms[0]?.version_label || null;
}
// then in the returned shape:
order: { ...existingFields, bom_version_label: bomVersionLabel },
```

- [ ] **Step 2: Import the modal and add state in MoDetail**

In `src/components/manufacturing/MoDetail.tsx` near other imports:

```typescript
import SaveAsVersionModal from './SaveAsVersionModal';
```

And alongside other `useState`:

```typescript
const [saveVersionOpen, setSaveVersionOpen] = useState(false);
const [versionToast, setVersionToast] = useState<{ label: string; bom_id: number } | null>(null);
```

- [ ] **Step 3: Add the button**

Near the existing action buttons (Confirm / Cancel / etc.), add a new secondary button that's only visible when `mo.can_save_version` is true:

```tsx
{mo?.can_save_version && (
  <button
    onClick={() => setSaveVersionOpen(true)}
    className="w-full rounded-full border border-orange-300 px-4 py-3 font-semibold text-orange-600 active:bg-orange-50"
  >
    Save as new version
  </button>
)}
```

- [ ] **Step 4: Mount the modal**

Before the component's closing tag:

```tsx
<SaveAsVersionModal
  moId={moId}
  open={saveVersionOpen}
  productName={mo?.product_id?.[1] || ''}
  sourceVersionLabel={mo?.bom_version_label || 'v.1'}
  onClose={() => setSaveVersionOpen(false)}
  onSaved={(res) => {
    setVersionToast(res);
    setTimeout(() => setVersionToast(null), 5000);
    fetchDetail();
  }}
/>

{versionToast && (
  <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-sm text-white shadow-lg">
    Saved as <span className="font-mono font-semibold">{versionToast.label}</span>
  </div>
)}
```

- [ ] **Step 5: Build, commit, deploy**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
git add src/app/api/manufacturing-orders/\[id\]/route.ts \
        src/components/manufacturing/MoDetail.tsx
git commit -m "feat(ui): wire Save-as-new-version into MoDetail"
git push origin main
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'
```

- [ ] **Step 6: Manual smoke**

Open a MO with a BOM. Tap "Save as new version" → modal opens with suggested label (e.g. "v.2"). Type "v.2 — test" and notes. Save. Toast appears. Re-open the MO — it still shows the original BOM label (we don't relink the MO).

---

## Stage 6 — Portal frontend: Recipe History

### Task 18: `RecipeHistory` screen

**Files:**
- Create: `src/components/manufacturing/RecipeHistory.tsx`

- [ ] **Step 1: Create the screen**

Write `src/components/manufacturing/RecipeHistory.tsx`:

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface RecipeHistoryProps {
  bomId: number;
  onBack: () => void;
  onOpenBom: (bomId: number) => void;
}

interface VersionRow {
  id: number;
  version_label: string;
  version_notes: string;
  parent_id: number | null;
  is_current_version: boolean;
  created_at: string;
  created_by: string | null;
  line_count: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RecipeHistory({ bomId, onBack, onOpenBom }: RecipeHistoryProps) {
  const [productName, setProductName] = useState<string>('');
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingCurrent, setSettingCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchHistory() {
    setLoading(true);
    try {
      const res = await fetch(`/api/boms/${bomId}/versions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setProductName(data.product_tmpl_id?.[1] || 'Recipe');
      setVersions(data.versions || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchHistory(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setAsCurrent(v: VersionRow) {
    if (!confirm(`Use ${v.version_label} as the default recipe for new batches?`)) return;
    setSettingCurrent(v.id);
    try {
      const res = await fetch(`/api/boms/${v.id}/set-current`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      await fetchHistory();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to set current');
    } finally {
      setSettingCurrent(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Recipe History" subtitle={productName} onBack={onBack} />
      <div className="px-4 py-3">
        {loading && <div className="py-8 text-center text-gray-500">Loading…</div>}
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {!loading && !error && versions.length === 0 && (
          <div className="py-8 text-center text-gray-500">No versions yet.</div>
        )}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3 active:bg-orange-50">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onOpenBom(v.id)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{v.version_label}</span>
                    {v.is_current_version && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(v.created_at)}
                    {v.created_by ? ` · ${v.created_by}` : ''}
                    {' · '}{v.line_count} ingredients
                  </div>
                  {v.version_notes && (
                    <div className="mt-1 line-clamp-2 text-sm text-gray-700">
                      {v.version_notes}
                    </div>
                  )}
                </button>
                {!v.is_current_version && (
                  <button
                    onClick={() => setAsCurrent(v)}
                    disabled={settingCurrent === v.id}
                    className="ml-3 rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"
                  >
                    {settingCurrent === v.id ? '…' : 'Set as current'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/manufacturing/RecipeHistory.tsx
git commit -m "feat(ui): RecipeHistory screen"
```

---

### Task 19: Wire RecipeHistory into BomDetail and Manufacturing routing

**Files:**
- Modify: `src/components/manufacturing/BomDetail.tsx`
- Modify: Manufacturing tab parent component (find via `grep -rn 'BomDetail' src/components/manufacturing | grep -v BomDetail.tsx`)

- [ ] **Step 1: Find the BomDetail caller**

```bash
cd /Users/ethan/Odoo_Portal_18EE
grep -rn 'from.*BomDetail' src/components/manufacturing
```

This shows which parent component routes between BOM list, BOM detail, and other screens (most likely `Dashboard.tsx` or `BomList.tsx` or a manufacturing-level switch). Note the file and the state machine.

- [ ] **Step 2: Add a "History" smart button on `BomDetail.tsx`**

Open `src/components/manufacturing/BomDetail.tsx`. Find the smart-button row (icons row near the top showing things like Versions, Steps). Add or extend with a "History" entry. If the file has `useEffect` fetching the BOM, also fetch `/api/boms/${bomId}/versions` to know whether to show the button (only if more than 1 version exists). Skeleton:

```tsx
const [versionCount, setVersionCount] = useState<number>(1);
useEffect(() => {
  fetch(`/api/boms/${bomId}/versions`).then((r) => r.json()).then((d) => {
    setVersionCount(d.versions?.length ?? 1);
  });
}, [bomId]);

// In the smart-button row:
{versionCount > 1 && (
  <button onClick={onOpenHistory}
          className="flex flex-col items-center justify-center rounded-2xl bg-orange-50 px-4 py-3 text-orange-700 active:bg-orange-100">
    <span className="text-xs uppercase">History</span>
    <span className="text-lg font-bold">{versionCount}</span>
  </button>
)}
```

Accept `onOpenHistory: () => void` as a new prop on the component, and add it to the props interface.

- [ ] **Step 3: Wire the parent router**

In the parent component identified in Step 1 (e.g. `Dashboard.tsx`), introduce a new screen state value `'recipe-history'` (alongside existing `'bom-detail'`, `'mo-detail'`, etc.). Add an `historyBomId` state. Render `<RecipeHistory bomId={historyBomId} onBack={() => setScreen('bom-detail')} onOpenBom={(id) => { setBomId(id); setScreen('bom-detail'); }} />` when `screen === 'recipe-history'`. Pass `onOpenHistory={() => { setHistoryBomId(bomId); setScreen('recipe-history'); }}` to `<BomDetail .../>`.

(Apply analogously if the parent uses Next.js routing instead of state.)

- [ ] **Step 4: Build**

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm run build
```

- [ ] **Step 5: Commit and deploy**

```bash
git add src/components/manufacturing/BomDetail.tsx \
        src/components/manufacturing/RecipeHistory.tsx \
        src/components/manufacturing/<parent_file_from_step_1>.tsx
git commit -m "feat(ui): RecipeHistory wired into BomDetail smart button"
git push origin main
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull --ff-only && npm run build && systemctl restart krawings-portal'
```

- [ ] **Step 6: Manual smoke**

After Stage 5's smoke produced two versions for the same recipe, navigate: BOM list → tap the BOM → smart-button row shows "History 2" → tap → see two rows, newest first, with "current" badge on the new one. Tap "Set as current" on the older row → confirmation → row's "current" badge moves.

---

## Stage 7 — Final integration smoke

### Task 20: End-to-end live test on a real recipe

**Files:** none (manual)

- [ ] **Step 1: Pick a real test BOM**

In the portal, pick a recipe you'd actually test today (e.g. "Jerk Marinade"). Note its current BOM id and version label (expected: `v.1` after migration).

- [ ] **Step 2: Create a small-batch MO**

Use Create MO in the portal. Quantity = 1 (or whatever your test batch is). Confirm the MO.

- [ ] **Step 3: Cook + tweak**

While the MO is in `confirmed`/`progress`:
- Edit one ingredient's qty (e.g. salt 5 g → 8 g).
- Add a new ingredient (e.g. lime juice 10 ml).
- Optionally remove one ingredient.

After each tweak, pull-to-refresh or back-and-in the MO. Confirm changes persist.

- [ ] **Step 4: Save as new version**

Tap Save as new version. Suggested label = "v.2". Add notes. Keep "current" toggle ON. Save. Toast appears.

- [ ] **Step 5: Verify history**

Navigate to BOM history. Two rows: v.1 and v.2. v.2 is current. Tap v.2 → ingredient list matches what you tweaked.

- [ ] **Step 6: Confirm next MO uses v.2**

Create another MO for the same product. Expect Odoo to default to the v.2 BOM (the current one). Verify the components match your tweaked recipe.

- [ ] **Step 7: Set v.1 as current and verify**

Back in history, tap "Set as current" on v.1. Create a new MO — Odoo should default to v.1 again.

- [ ] **Step 8: Final commit (if any cleanup edits emerged)**

If smoke testing surfaced minor bugs, fix them, build, and commit with descriptive messages. Otherwise, no commit needed — the feature is done.

---

## Self-Review Checklist (for the implementer)

Before declaring done:

- [ ] All 20 tasks committed on `main`. No side branches.
- [ ] Staging Odoo restarted after Stage 1; staging portal restarted after Stages 2/4/5/6.
- [ ] `npm run build` exits 0 locally on the last commit.
- [ ] `-u krawings_recipe_config --stop-after-init` exits 0 on staging.
- [ ] The hard end-to-end flow in Task 20 succeeded.
- [ ] No `console.log` debugging left behind in modified TSX files.
- [ ] The post-init backfill log line was observed during the Stage 1 deploy.

## Rollback recipe

If a stage breaks production:

- **Portal regression:** revert the last commits on `main` and redeploy. UI hides itself.
- **Odoo regression:** revert the most recent commits to `krawings_recipe_config`, push, pull on staging, run `-u krawings_recipe_config --stop-after-init`. The post-init hook is idempotent; the new fields are nullable so leaving them in place after revert is also harmless.
- **Need to drop fields entirely (last resort):** run on staging: `sudo -u postgres psql -d krawings -c "ALTER TABLE mrp_bom DROP COLUMN version_label, DROP COLUMN version_notes, DROP COLUMN version_parent_id, DROP COLUMN version_root_id, DROP COLUMN is_current_version;"` then `-u krawings_recipe_config`. Last-resort because it discards any saved version data.
