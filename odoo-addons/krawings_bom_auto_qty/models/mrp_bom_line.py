from odoo import models, api


_TOL = 0.0001


class MrpBomLine(models.Model):
    _inherit = "mrp.bom.line"

    def _realign_parent_bom(self):
        for bom in self.mapped("bom_id"):
            new_qty = sum(bom.bom_line_ids.mapped("product_qty"))
            if new_qty and abs(bom.product_qty - new_qty) > _TOL:
                bom.with_context(skip_bom_auto_qty=True).write(
                    {"product_qty": new_qty}
                )

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._realign_parent_bom()
        return records

    def write(self, vals):
        result = super().write(vals)
        if "product_qty" in vals:
            self._realign_parent_bom()
        return result

    def unlink(self):
        boms = self.mapped("bom_id")
        result = super().unlink()
        for bom in boms:
            new_qty = sum(bom.bom_line_ids.mapped("product_qty"))
            if new_qty and abs(bom.product_qty - new_qty) > _TOL:
                bom.with_context(skip_bom_auto_qty=True).write(
                    {"product_qty": new_qty}
                )
        return result
