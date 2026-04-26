from odoo import _, api, models
from odoo.exceptions import UserError

KRAWINGS_LOCKED_COMPANY_IDS = (5,)
SKIP_CONTEXT_KEY = 'skip_bom_qty_sync'


class MrpBom(models.Model):
    _inherit = 'mrp.bom'

    def _krawings_qty_locked(self):
        self.ensure_one()
        return self.company_id.id in KRAWINGS_LOCKED_COMPANY_IDS

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
            for bom in self:
                if bom._krawings_qty_locked():
                    raise UserError(_(
                        "Output quantity for What a Jerk recipes is calculated "
                        "automatically from the sum of ingredient weights. "
                        "Edit the ingredient list to change the output."
                    ))
        return super().write(vals)
