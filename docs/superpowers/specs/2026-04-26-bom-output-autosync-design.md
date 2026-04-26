# BOM Output Lock — Design

**Date:** 2026-04-26
**Module:** `krawings_bom_auto_qty` (existing v1 → v2 enhancement)
**Scope:** Odoo 18 EE backend, What a Jerk (company_id=5) only

## Problem

BOM `product_qty` (output) and the sum of `bom_line.product_qty` can drift
apart silently. Real example: BOM 165 "Oxtail Stew — Storage Pack 14d" had
output 8.5 kg while ingredients summed to 10.0 kg (117.7%).

The existing v1 module already auto-syncs the output when an ingredient line
is added/changed/removed, but has gaps:

1. Direct edits to `mrp.bom.product_qty` (typing into the Quantity field on
   the BOM form) bypass the line-level hooks. This is how the 5 audit-found
   drifts happened.
2. The Quantity field is editable, so users see no signal that the value is
   meant to be derived.

## Goal

For What a Jerk BOMs only:
1. The Quantity field is read-only in the form view.
2. Server-side `mrp.bom.write({'product_qty': ...})` calls are rejected with
   a clear error unless they come from this module's own resync flow
   (identified by `skip_bom_qty_sync` context flag).
3. New BOMs trigger an immediate sync after creation (covers the case where
   the form initial value would otherwise persist on a brand-new BOM).

Other companies (Ssam Korean BBQ, etc.) keep the existing v1 behavior — line
changes auto-sync, but the field remains editable.

## Non-goals

- Volume-to-mass conversion via product densities.
- Hard-fail on mixed UoM categories (current v1 silently skips; keeping that
  to avoid regressions on Ssam batch-Unit BOMs).
- Migration of Ssam batch-Unit BOMs to mass output.

## Scoping mechanism

Hardcoded constant in `models/mrp_bom.py`:

```python
KRAWINGS_LOCKED_COMPANY_IDS = (5,)
```

Edit the tuple to add or remove companies. View-side scoping uses the same
literal (`company_id == 5`) — keep them in sync if changed.

## Implementation

### `MrpBom` (`mrp.bom`) — new file `models/mrp_bom.py`

- `_krawings_qty_locked()` — instance check; True if `company_id` is in the
  locked tuple.
- `create()` — calls super, then for each new BOM with lines, triggers
  `bom.bom_line_ids._sync_bom_product_qty()` (the existing v1 method on
  `mrp.bom.line`). Honors `skip_bom_qty_sync` context.
- `write()` — if `product_qty` is in `vals` and the context flag is not
  set, raises `UserError` for any in-scope BOM. Then calls super.

### `MrpBomLine` (`mrp.bom.line`) — unchanged from v1

The existing `_sync_bom_product_qty` method is reused. Its writes to
`mrp.bom.product_qty` already use `with_context(skip_bom_qty_sync=True)`,
which the new `MrpBom.write()` honors.

### View — new file `views/mrp_bom_views.xml`

Inherits `mrp.mrp_bom_form_view` and sets:
```xml
<attribute name="readonly">company_id == 5</attribute>
```
on the `product_qty` field, plus a help string.

### Manifest

Bump version to `18.0.2.0.0`. Add `views/mrp_bom_views.xml` to the `data`
list. Update description to document the v2 lock behavior.

## Edge cases

| Case | Behavior |
|---|---|
| New WAJ BOM, no lines yet | `create()` resync skips empty-line BOMs; the user-entered Quantity (or default 1.0) persists until the first line is added. |
| Direct API write to `product_qty` on WAJ BOM | `UserError` blocks write. Bypass via `with_context(skip_bom_qty_sync=True)` (used by the module's own resync). |
| Ssam BBQ BOM | All v2 changes no-op (scope check returns False; view inheritance keeps field editable since `company_id != 5`). |
| Mixed UoM line on WAJ BOM | v1 silent-skip behavior preserved. Total is summed from compatible lines only; bad lines are logged at WARNING. |

## Migration / rollout

1. **Pre-conditions:** all 49 active WAJ BOMs already comply (audit done
   2026-04-26; 5 fixes applied: BOMs 7, 82, 88, 152, 165).
2. **Deploy:** push branch to GitHub, pull on staging server. Replace
   `/opt/odoo/18.0/custom-addons/krawings_bom_auto_qty` real folder with a
   symlink to `/opt/odoo/18.0/portal-repo/odoo-modules/krawings_bom_auto_qty`
   (matches the convention used for `krawings_recipe_config`).
3. **Test:**
   ```
   /opt/odoo/18.0/odoo-18.0/venv/bin/python3 \
     /opt/odoo/18.0/odoo-18.0/odoo-bin \
     -c /opt/odoo/18.0/odoo-18.0/odoo.conf \
     -d krawings -u krawings_bom_auto_qty --stop-after-init
   ```
4. **Restart:** `systemctl restart odoo-18`
5. **Verify in UI:**
   - Open Oxtail Stew Storage Pack 14d (BOM 165). Quantity field should be
     greyed out.
   - Edit a line qty and save. Output should auto-update.
   - Open any Ssam BBQ BOM. Quantity field still editable.
6. **Verify via RPC:** attempt a direct write to `mrp.bom.product_qty` for
   a WAJ BOM. Expect `UserError`.

## Rollback

Downgrade or uninstall the module (or revert to v1 by checking out the
prior commit and re-running `--update`). Existing BOM data unchanged.

## Files

```
odoo-modules/krawings_bom_auto_qty/
├── __init__.py
├── __manifest__.py                    (bump 18.0.1.0.0 -> 18.0.2.0.0)
├── models/
│   ├── __init__.py                    (+ from . import mrp_bom)
│   ├── mrp_bom.py                     (new)
│   └── mrp_bom_line.py                (unchanged)
├── security/                          (unchanged)
└── views/
    └── mrp_bom_views.xml              (new)
```

## Risk

Low. v1 hooks are unchanged. New `MrpBom.write()` only blocks writes when
`product_qty` is in vals AND the company is What a Jerk AND no skip-context
is set. View change is single-attribute on existing field.
