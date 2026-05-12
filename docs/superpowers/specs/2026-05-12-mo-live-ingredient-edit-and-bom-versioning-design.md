# MO Live Ingredient Edit + BOM Versioning — Design

**Date:** 2026-05-12
**Module(s):** `krawings_recipe_config` (Odoo), Manufacturing module (Portal)
**Scope:** Krawings Portal (Next.js) + companion Odoo 18 EE module. Targets What a Jerk recipe-testing workflow first, but the underlying fields are not company-scoped — any What a Jerk MO with a BOM can use it.

## Problem

The chef tests recipes by creating small-batch MOs (e.g. 1 portion of "Jerk Marinade"). While cooking, they realise the recipe needs tweaks — a pinch more salt, an extra splash of lime juice, a new ingredient that wasn't planned. Today there is no way to:

1. Change the ingredient list of an in-progress MO from the portal (UI only shows components, no editing).
2. Capture those tweaks as a saved, traceable new recipe version that the next batch can be cooked from.

The chef ends up cooking by feel, then trying to remember the changes back at a desk. The recipe never gets formally updated, or it gets updated as a guess.

## Goal

While an MO is in progress, the chef can:

1. **Adjust** the planned quantity of any ingredient line.
2. **Remove** an ingredient line that isn't being used.
3. **Add** an ingredient that wasn't in the original BOM.
4. **Save the resulting ingredient list as a new BOM version**, with a label and notes, linked to the source version. Optionally mark the new version as the "current" recipe so future MOs use it by default.
5. **View the version history** of a recipe — list of versions with labels, dates, authors, notes; tap any version to see its ingredient list; option to set an older version as current again.

The original MO stays linked to the BOM it was created from (audit trail: "this batch was cooked based on v.2; v.3 was derived from these tweaks").

## Non-goals

- Cooking-step (instruction) versioning — that already lives in `krawings.recipe.version` and is out of scope here. The two version systems coexist; we do not merge or rename them.
- Cost recomputation across historical MOs when a version is saved.
- Branching version trees (v.3a / v.3b). History is a linear chain via `version_parent_id`.
- Editing or adding ingredients on MOs in `done` or `cancel` state. Only `draft`, `confirmed`, `progress`.
- Multi-company UI gating — the feature is shown on every MO regardless of company. (We can hide it later if Ssam wants it off.)
- Auto-scaling the new BOM to a different batch size — the new version is saved at the MO's `qty_producing`. The chef can rescale manually later.
- Bulk operations (compare two versions, merge two versions, fork) — design lays the foundation but UI is single-version only in v1.

## Mental model

A **recipe** has a **chain of BOM versions**: v.1 → v.2 → v.3. Each version is its own `mrp.bom` record. They are linked by two new fields:

- `version_parent_id` — Many2one self. v.3's parent is v.2. v.1 has no parent.
- `version_root_id` — Many2one self, computed by walking parents to the top. All versions of "Jerk Marinade" share the same root. Used for fast history queries (`search([('version_root_id', '=', root_id)])`).

Plus three more fields on `mrp.bom`:

- `version_label` (Char, default "v.1") — free-form label. UI suggests `v.N+1` when saving, user can override.
- `version_notes` (Text) — chef's note about what changed and why.
- `is_current_version` (Boolean) — exactly one BOM per `version_root_id` is current. Used as default `bom_id` when creating MOs from the product.

A new BOM version is created from an MO by:

1. Reading the MO's current consumed-and-planned move_raw_ids state.
2. Copying the source BOM (parent fields, UOM, product_id).
3. Replacing its `bom_line_ids` with lines derived from the MO's moves.
4. Setting `version_parent_id` to the source BOM, copying root_id, assigning `version_label` and `version_notes`.
5. Optionally toggling `is_current_version`: unset on the prior current BOM, set on the new one.

The MO itself is not modified by the save — its `bom_id` stays pointing at the source version.

## Implementation

### Odoo backend — `odoo-modules/krawings_recipe_config/`

#### New fields on `mrp.bom` (`models/mrp_bom.py`)

```python
version_label = fields.Char(string='Version', default='v.1', tracking=True,
    copy=False)
version_notes = fields.Text(string='Version Notes', copy=False)
version_parent_id = fields.Many2one('mrp.bom', string='Derived From',
    ondelete='restrict', index=True, copy=False)
version_root_id = fields.Many2one('mrp.bom', string='Recipe Root',
    compute='_compute_version_root_id', store=True, index=True,
    recursive=True)
is_current_version = fields.Boolean(string='Current Version', default=True,
    index=True, copy=False)
version_count = fields.Integer(compute='_compute_version_count')

@api.depends('version_parent_id', 'version_parent_id.version_root_id')
def _compute_version_root_id(self):
    for bom in self:
        bom.version_root_id = bom.version_parent_id.version_root_id or bom

def _compute_version_count(self):
    # Count of BOMs sharing this BOM's version_root_id
    grouped = self.read_group(
        [('version_root_id', 'in', self.ids)],
        ['version_root_id'], ['version_root_id'])
    counts = {g['version_root_id'][0]: g['version_root_id_count'] for g in grouped}
    for bom in self:
        bom.version_count = counts.get(bom.id, 1)
```

**Migration of existing BOMs:** in `__manifest__.py` we bump version and add a post-init hook that backfills `version_root_id = self.id` for every existing BOM (each becomes the root of its own one-version chain). No data loss.

**Uniqueness constraint:** SQL constraint that at most one BOM per `version_root_id` is `is_current_version = True`. Implemented as a Python `_check_single_current` constraint rather than SQL since we want a clear error message.

#### New method on `mrp.production` (`models/mrp_production.py` — new file)

```python
def action_save_as_new_bom_version(self, version_label, version_notes,
                                    make_current=True):
    """Create a new mrp.bom whose lines mirror this MO's current
    raw-material moves, link it as the next version of self.bom_id.
    Returns the new bom's id."""
```

Logic:

1. Require `self.bom_id` (cannot save a version for a BOM-less MO — v1 limitation).
2. Require state in `('draft', 'confirmed', 'progress', 'to_close')`.
3. Build line specs from `self.move_raw_ids` filtered to `state != 'cancel'`. For each move:
   - `product_id` = move.product_id
   - `product_qty` = move.product_uom_qty (planned qty — this is what the chef tweaked via the API)
   - `product_uom_id` = move.product_uom
4. Call `self.bom_id.copy({...})` with the new label/notes/parent fields and an empty `bom_line_ids`. The version fields are `copy=False` so they start clean on the copy; we set them explicitly.
5. After copy, write the line specs onto the new BOM.
6. Explicitly set `is_current_version` on the new BOM based on the `make_current` argument (do not rely on the field default — `copy=False` left it False). If `make_current=True`, first set `is_current_version=False` on the prior current BOM in this chain, THEN set True on the new one — ordered to satisfy the "at most one current" constraint.
7. Return new BOM id + summary dict.

Wrap in a single transaction.

#### Editing MO ingredients

We do NOT extend `mrp.production` with a custom edit method — Odoo already supports adding/removing/updating `move_raw_ids` on a confirmed MO. The portal API will call the standard ORM `write` on `stock.move` records, scoped to moves where `raw_material_production_id = self.id`.

For **adding a new ingredient**: create a `stock.move` with `raw_material_production_id` set, plus the standard required fields (`name`, `product_id`, `product_uom_qty`, `product_uom`, `location_id` = MO's `location_src_id`, `location_dest_id` = production location). Odoo's `_action_confirm` on the MO already runs; new moves on a confirmed MO need `_action_confirm()` called explicitly.

For **removing**: only allow if the move is not yet done (no `move_line_ids` with `qty_done > 0`). Otherwise return an error.

For **updating qty**: write to `product_uom_qty` on the move. Same not-yet-done guard.

#### View — `views/mrp_bom_views.xml`

Add to existing BOM form view:

- Group "Version" with `version_label`, `version_notes`, `version_parent_id` (readonly), `is_current_version` (toggle, disabled if no other versions exist).
- Smart button: `version_count` opening a list filtered by `version_root_id`.

No new menu item — versions are reached from any BOM.

#### Security

Existing `mrp.bom` ACLs cover the new fields. New method `action_save_as_new_bom_version` runs as the calling user; standard `mrp.bom` create permission applies (manager-level by default in Odoo's `mrp` group).

#### Manifest

Bump `krawings_recipe_config` to next minor version. Add `models/mrp_production.py` to `__init__.py`. Post-init hook for `version_root_id` backfill.

### Portal API — `src/app/api/`

#### Existing route — `manufacturing-orders/[id]/route.ts`

Add to the response: each component now includes `move_id` (the `stock.move` id), `planned_qty` (= `product_uom_qty`), `consumed_qty`, and `can_edit` (computed: state is editable AND no `qty_done` yet).

#### New route — `manufacturing-orders/[id]/components/route.ts`

- `POST` — add a new ingredient line.
  Body: `{ product_id: number, qty: number, uom_id?: number }`
  Returns new component descriptor.

#### New route — `manufacturing-orders/[id]/components/[moveId]/route.ts`

- `PATCH` — update qty on existing line.
  Body: `{ qty: number }`
- `DELETE` — remove an unconsumed line.

All three call Odoo via the existing `src/lib/odoo.ts` server-side helper. Guards: MO state must be editable; move must be not-done for PATCH/DELETE.

#### New route — `manufacturing-orders/[id]/save-as-version/route.ts`

- `POST` — call `mrp.production.action_save_as_new_bom_version`.
  Body: `{ version_label: string, version_notes: string, make_current: boolean }`
  Returns: `{ bom_id: number, version_label, version_count }`

#### New route — `boms/[id]/versions/route.ts`

- `GET` — list all BOM versions sharing this BOM's `version_root_id`.
  Returns: `[{ id, version_label, version_notes, create_date, create_uid: [id, name], is_current_version, line_count }]`, newest first.

#### New route — `boms/[id]/set-current/route.ts`

- `POST` — set this BOM as the current version of its chain. Unsets the prior current BOM in the same chain.

### Portal frontend — `src/components/manufacturing/`

#### `MoDetail.tsx` — extend the existing components section

- Each component row gets:
  - Tap target (whole row) opens an **edit bottom sheet** with current qty, +/− buttons, "Remove" link.
  - If component is already consumed (qty_done > 0), the row is read-only with a "consumed" badge — no edit affordance.
- Below the components list:
  - **`+ Add ingredient`** button. Opens a product picker bottom sheet (reuse existing pattern from CreateMo.tsx if present; otherwise build a simple search-and-tap sheet against `/api/products?search=...`).
- Below the action buttons (Confirm / Done / etc.), a new secondary button:
  - **Save as new version** — disabled unless the MO has a `bom_id`. Opens a modal.

#### New component — `SaveAsVersionModal.tsx`

Modal contents:

- Read-only header: "Saving from <product name> — <current BOM label>"
- **Version label** input, prefilled with suggested next label (e.g. if source is "v.2", suggest "v.3"; if source is "v.3 — lime", suggest "v.4"). Free-form, max 64 chars.
- **Notes** textarea, max 1000 chars, placeholder "What changed and why?"
- **Make this the current recipe** toggle, on by default. Tooltip: "New MOs for this product will use this version by default."
- **Save** primary button (orange #F5800A per DESIGN_GUIDE.md), **Cancel** ghost button.
- On save: POST to `save-as-version`, on success show toast "Saved as <label>", close modal, refresh MO detail. On error show inline error in the modal.

#### New screen — `RecipeHistory.tsx`

Reached from BomDetail.tsx (new "History" smart button) and from the post-save toast ("View history" CTA).

- AppHeader: "Recipe History — <product name>"
- List of versions (newest first), each row:
  - **Big** version label (e.g. "v.3 — lime") in bold
  - "Current" badge if `is_current_version`
  - Date + author small under the label
  - Notes preview (2-line truncation)
  - Right side: chevron
- Tapping a row opens that version's BomDetail (existing screen, parameterised by bom_id).
- Row swipe (or kebab menu) action: **Set as current** — only shown for non-current versions. Confirmation dialog ("Use <label> as the default recipe for new MOs?"). Calls `set-current` route.

#### Routing

- BomDetail gets a `?from=history` URL param so back-arrow returns to history instead of BOM list.

### Plain-language strings (user-facing, per `src/lib/ux-rules.ts`)

| Field/button | User-facing string |
|---|---|
| `version_label` | "Version" |
| `version_notes` | "What changed" |
| `is_current_version` | "Current recipe" |
| Save button on MO | "Save as new version" |
| Modal title | "Save changes as a new version" |
| Set-current confirm | "Use this version as the default recipe for new batches?" |

No ERP jargon like "BOM", "consumption move", "raw_material_production_id" anywhere in the UI.

## Data flow — end-to-end happy path

1. Chef opens MO 1234 for "Jerk Marinade" (bom_id = 45, label "v.2") in portal. State: `confirmed`.
2. Adjusts salt from 5 g to 8 g → portal `PATCH /api/manufacturing-orders/1234/components/movXX { qty: 8 }` → Odoo writes `stock.move.product_uom_qty = 8`.
3. Adds lime juice 10 ml → portal `POST /api/manufacturing-orders/1234/components { product_id: 99, qty: 10 }` → Odoo creates a new `stock.move` linked to the MO, calls `_action_confirm()`.
4. Chef taps **Save as new version**. Modal opens with suggested label "v.3", empty notes, "current" toggle on.
5. Chef types notes "more salt, added lime — punchier" and taps Save.
6. Portal `POST /api/manufacturing-orders/1234/save-as-version { version_label: "v.3", version_notes: "more salt, added lime — punchier", make_current: true }` → Odoo `action_save_as_new_bom_version`:
   - Copies BOM 45 → new BOM 78.
   - Writes lines mirroring MO's 4 current ingredients including lime juice 10 ml.
   - Sets `version_parent_id=45`, `version_label='v.3'`, `version_notes='more salt, added lime — punchier'`.
   - `version_root_id` of new BOM resolves to BOM 45's root (let's say BOM 12, the original v.1).
   - Sets BOM 45's `is_current_version=False`, BOM 78's `is_current_version=True`.
7. Returns to portal. Toast "Saved as v.3" with "View history" CTA.
8. MO 1234 stays linked to BOM 45 (the version it was cooked under).
9. Chef next time creates a new MO for Jerk Marinade — Odoo's default BOM selection prefers the `is_current_version=True` BOM, so the new MO loads v.3 ingredients.

## Edge cases

| Case | Behavior |
|---|---|
| MO has no `bom_id` (created from scratch) | "Save as new version" button hidden. v1 limitation; documented in UI tooltip on hover/long-press: "This batch isn't linked to a saved recipe yet." |
| Component already consumed (`qty_done > 0`) | Row shown read-only with "consumed" badge. No qty edit, no remove. Add-new-ingredient still works. |
| MO state is `done` or `cancel` | All edit affordances hidden. "Save as new version" hidden. |
| Two simultaneous saves race for `is_current_version` | The Python constraint catches it on the second save and returns a clear error ("Another version was just set as current; reload and try again"). |
| Source BOM has no `version_root_id` yet (existing BOM pre-migration) | Post-init hook backfills root = self.id at module update time. If a BOM is somehow missed, `_compute_version_root_id` defaults to `bom_id = self`. |
| Source BOM is archived | Saving a new version unarchives nothing; new BOM is created active. Old BOM stays archived. |
| Lime juice product doesn't exist | Product picker shows search results from `product.product` filtered to `purchase_ok=True` or `sale_ok=True` (matching CreateMo.tsx logic). If chef needs a brand-new product, they must create it in Odoo or a "+ New product" flow (out of scope for v1). |
| UoM mismatch (chef enters "10" with no unit; original line is in kg, chef means g) | Modal/sheet shows the current line's UoM next to the input. No auto-conversion. Chef enters value in that UoM. |
| Chef cancels modal halfway | No changes persisted. Their MO ingredient edits remain (those were saved when each tap happened). They can save the version later. |
| Multi-tab editing | Last write wins, both on the MO and on the version save. We surface the up-to-date state on each `fetchDetail()` refresh. |

## Testing

### Backend (Odoo)

1. **Unit:** create a BOM, copy as new version, assert version_root_id matches across chain, assert is_current_version flips correctly.
2. **Constraint:** try to set two BOMs in the same chain to current; expect ValidationError.
3. **Backfill:** install fresh DB, install module, assert every existing BOM has `version_root_id = self.id` and `version_label = 'v.1'`.
4. **Integration:** create an MO from a BOM, modify a raw move qty, call `action_save_as_new_bom_version`, assert new BOM lines match modified moves.

### Portal

1. Manual on staging: open an existing What a Jerk MO, edit a qty via the sheet, refresh — qty persists.
2. Add a new ingredient, refresh — new line appears.
3. Remove an ingredient with qty_done=0 — line disappears; with qty_done>0 — remove button missing.
4. Save as new version — modal opens with sensible default label, save succeeds, toast appears.
5. Open Recipe History — both versions listed, correct current badge.
6. Set older as current — confirmation prompt fires, label flips.

### Verification commands

```bash
# Backend
ssh root@89.167.124.0 \
  '/opt/odoo/18.0/odoo-18.0/venv/bin/python3 /opt/odoo/18.0/odoo-18.0/odoo-bin \
   -c /opt/odoo/18.0/odoo-18.0/odoo.conf -d krawings \
   -u krawings_recipe_config --stop-after-init'

# Portal
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull && npm run build && systemctl restart krawings-portal'
```

## Files

```
odoo-modules/krawings_recipe_config/
├── __manifest__.py                                    (bump version, add post-init hook)
├── models/
│   ├── __init__.py                                    (+ from . import mrp_production)
│   ├── mrp_bom.py                                     (add 5 fields + 2 computes + constraint)
│   └── mrp_production.py                              (new — action_save_as_new_bom_version)
├── views/
│   └── mrp_bom_views.xml                              (add Version group + history smart button)
└── hooks.py                                           (new — post_init backfill)

src/app/api/
├── manufacturing-orders/[id]/route.ts                 (add move_id, planned_qty, can_edit)
├── manufacturing-orders/[id]/components/route.ts      (new — POST add)
├── manufacturing-orders/[id]/components/[moveId]/route.ts (new — PATCH, DELETE)
├── manufacturing-orders/[id]/save-as-version/route.ts (new — POST)
├── boms/[id]/versions/route.ts                        (new — GET history)
└── boms/[id]/set-current/route.ts                     (new — POST)

src/components/manufacturing/
├── MoDetail.tsx                                       (extend: edit sheet, add button, save-version button)
├── BomDetail.tsx                                      (add history smart button)
├── EditComponentSheet.tsx                             (new)
├── AddIngredientSheet.tsx                             (new — wraps product picker)
├── SaveAsVersionModal.tsx                             (new)
└── RecipeHistory.tsx                                  (new)
```

## Risk

Medium. New fields on `mrp.bom` touch a heavily-used table — the post-init backfill must be fast (single UPDATE) and the new constraints must not regress BOM creation. Editing `stock.move` on a confirmed MO is a supported Odoo flow but the portal currently never does it, so this is a new code path to harden. `is_current_version` toggle is the most likely source of user confusion if mis-clicked.

Mitigations: post-init hook runs in a single SQL UPDATE; constraint has a clear error message; "current" toggle is opt-in (defaults on at first save but can be unticked); destructive actions (delete line, set older version as current) gated by confirmation.

## Rollback

Disable the new buttons in the portal by reverting the frontend commit (server-side endpoints can stay; they just won't be reachable from the UI). For full rollback, uninstall the module changes by reverting the Odoo commit and running `-u krawings_recipe_config`. New fields default to safe values (version_label='v.1', is_current_version=True), so leaving them installed but unused is also fine.

## Open questions (resolve before plan)

None — design approved verbally with user 2026-05-12.
