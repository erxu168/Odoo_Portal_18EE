from odoo import _, api, models
from odoo.exceptions import UserError

KRAWINGS_LOCKED_COMPANY_IDS = (5,)
SKIP_CONTEXT_KEY = 'skip_bom_qty_sync'
QTY_TOLERANCE = 1e-6


class MrpBom(models.Model):
    _inherit = 'mrp.bom'

    def _krawings_qty_locked(self):
        self.ensure_one()
        return self.company_id.id in KRAWINGS_LOCKED_COMPANY_IDS

    @api.onchange('bom_line_ids', 'product_uom_id', 'company_id')
    def _onchange_recompute_qty_for_locked(self):
        """Live form recompute for locked companies.

        Fills product_qty in the open form as the user adds, removes, or
        edits ingredients — no save required to see the new total. Mirrors
        the server-side _sync_bom_product_qty math; mismatched-UoM lines
        are silently skipped (consistent with v1 behavior).
        """
        if not self._krawings_qty_locked():
            return
        bom_uom = self.product_uom_id
        if not bom_uom:
            return
        bom_uom_categ = bom_uom.category_id
        total = 0.0
        for line in self.bom_line_ids:
            if not line.product_uom_id:
                continue
            if line.product_uom_id.category_id != bom_uom_categ:
                continue
            if line.product_uom_id == bom_uom:
                total += line.product_qty
            else:
                total += line.product_qty * (
                    line.product_uom_id.factor / bom_uom.factor
                )
        if total > 0:
            self.product_qty = round(total, 4)

    @api.model_create_multi
    def create(self, vals_list):
        boms = super().create(vals_list)
        if not self.env.context.get(SKIP_CONTEXT_KEY):
            for bom in boms:
                if bom.bom_line_ids:
                    bom.bom_line_ids._sync_bom_product_qty()
        return boms

    def write(self, vals):
        if (
            'product_qty' in vals
            and not self.env.context.get(SKIP_CONTEXT_KEY)
        ):
            new_qty = vals['product_qty']
            locked_with_real_change = self.filtered(
                lambda b: b._krawings_qty_locked()
                and abs(b.product_qty - new_qty) > QTY_TOLERANCE
            )
            if locked_with_real_change:
                raise UserError(_(
                    "Output quantity for What a Jerk recipes is calculated "
                    "automatically from the sum of ingredient weights. "
                    "Edit the ingredient list to change the output."
                ))
            # Strip stale-but-equal product_qty so the line-trigger sync owns
            # the value. Without this, a form save that includes the
            # readonly-displayed value can race with the sync result.
            if any(b._krawings_qty_locked() for b in self):
                vals = {k: v for k, v in vals.items() if k != 'product_qty'}
        return super().write(vals)
