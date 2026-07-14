import logging
from odoo import models, api

_logger = logging.getLogger(__name__)


class MrpBomLine(models.Model):
    _inherit = "mrp.bom.line"

    def _sync_bom_product_qty(self):
        """Recalculate parent BOM product_qty as sum of line quantities."""
        bom_ids = self.mapped("bom_id")
        for bom in bom_ids:
            lines = bom.bom_line_ids
            if not lines:
                continue
            bom_uom = bom.product_uom_id
            bom_uom_categ = bom_uom.category_id
            total = 0.0
            skipped = False
            for line in lines:
                if line.product_uom_id.category_id == bom_uom_categ:
                    if line.product_uom_id == bom_uom:
                        # Same UoM — add raw qty, no rounding
                        total += line.product_qty
                    else:
                        # Different UoM in same category — convert
                        # Use factor directly to avoid per-line rounding
                        total += line.product_qty * (
                            line.product_uom_id.factor / bom_uom.factor
                        )
                else:
                    skipped = True
                    _logger.warning(
                        "[krawings_bom_auto_qty] BOM %s (id=%d): skipping "
                        "line %s — UoM %s not convertible to %s",
                        bom.display_name, bom.id,
                        line.product_id.display_name,
                        line.product_uom_id.name,
                        bom_uom.name,
                    )
            if total > 0:
                # Round only the final total to 4 decimal places
                total = round(total, 4)
                if abs(total - bom.product_qty) > 0.0001:
                    _logger.info(
                        "[krawings_bom_auto_qty] BOM %s: product_qty "
                        "%.4f -> %.4f%s",
                        bom.display_name, bom.product_qty, total,
                        " (some lines skipped due to UoM mismatch)"
                        if skipped else "",
                    )
                    bom.with_context(skip_bom_qty_sync=True).write(
                        {"product_qty": total}
                    )

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        if not self.env.context.get("skip_bom_qty_sync"):
            records._sync_bom_product_qty()
        return records

    def write(self, vals):
        res = super().write(vals)
        if "product_qty" in vals and not self.env.context.get(
            "skip_bom_qty_sync"
        ):
            self._sync_bom_product_qty()
        return res

    def unlink(self):
        bom_ids = self.mapped("bom_id")
        res = super().unlink()
        if not self.env.context.get("skip_bom_qty_sync"):
            for bom in bom_ids:
                if bom.exists() and bom.bom_line_ids:
                    bom.bom_line_ids[:1]._sync_bom_product_qty()
            for bom in bom_ids:
                if bom.exists() and not bom.bom_line_ids:
                    bom.with_context(skip_bom_qty_sync=True).write(
                        {"product_qty": 0}
                    )
        return res
