from odoo import models, _
from odoo.exceptions import UserError


_TOL = 0.0001


class MrpBom(models.Model):
    _inherit = "mrp.bom"

    def write(self, vals):
        # Reject manual product_qty writes that disagree with the sum of
        # current line weights. Internal recomputes set skip_bom_auto_qty=True.
        if "product_qty" in vals and not self.env.context.get("skip_bom_auto_qty"):
            new_qty = vals["product_qty"]
            for bom in self:
                expected = sum(bom.bom_line_ids.mapped("product_qty"))
                # Allow writes that match the expected value (no-op vs sum).
                if expected and abs(new_qty - expected) > _TOL:
                    raise UserError(_(
                        "Output quantity for this recipe is calculated automatically "
                        "from the sum of ingredient weights. Edit the ingredient list "
                        "to change the output."
                    ))
        result = super().write(vals)
        # If lines were edited via this write, realign product_qty.
        if "bom_line_ids" in vals:
            for bom in self:
                new_qty = sum(bom.bom_line_ids.mapped("product_qty"))
                if new_qty and abs(bom.product_qty - new_qty) > _TOL:
                    super(MrpBom, bom.with_context(skip_bom_auto_qty=True)).write(
                        {"product_qty": new_qty}
                    )
        return result
