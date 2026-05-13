from odoo import models
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
