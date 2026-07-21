from odoo import api, fields, models
from odoo.exceptions import ValidationError


class KrawingsTaskTemplateSubtask(models.Model):
    _name = 'krawings.task.template.subtask'
    _description = 'Department Task Template Subtask'
    _order = 'sequence, id'

    line_id = fields.Many2one(
        'krawings.task.template.line', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)

    # ── Setup-guide pin (only meaningful when the parent line is_setup_guide) ──
    # Stored as fractions of the reference image so they survive different
    # screen sizes; the portal converts to %. On a setup-guide line EVERY
    # subtask is a pin (v1 invariant).
    pin_photo_seq = fields.Integer(
        default=0,
        help='Sequence of the setup photo this pin sits on (multi-photo guides).',
    )
    pin_x = fields.Float(help='0.0–1.0, fraction across the reference image.')
    pin_y = fields.Float(help='0.0–1.0, fraction down the reference image.')
    item_id = fields.Many2one(
        'krawings.task.item', ondelete='set null', index=True,
        help='Catalog item this pin labels. name is denormalised for history.',
    )

    @api.constrains('pin_x', 'pin_y')
    def _check_pin_bounds(self):
        for rec in self:
            for val in (rec.pin_x, rec.pin_y):
                if val < 0.0 or val > 1.0:
                    raise ValidationError('Pin coordinates must be between 0 and 1.')
