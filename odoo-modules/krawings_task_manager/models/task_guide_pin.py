from odoo import api, fields, models
from odoo.exceptions import ValidationError


class KrawingsTaskGuidePin(models.Model):
    """A numbered note-pin on a photo guide step. Coordinates are fractions
    (0..1) of the displayed image, so they survive different screen sizes.
    Pin numbers are LOCAL to the step and derived from `sequence` order — they
    are never stored as a display number, so reordering the guide's steps never
    renumbers pins. Purely instructional: a pin never affects task completion."""
    _name = 'krawings.task.guide.pin'
    _description = 'Guided Tutorial Note-Pin'
    _order = 'sequence, id'

    step_id = fields.Many2one(
        'krawings.task.guide.step', required=True, ondelete='cascade', index=True,
    )
    sequence = fields.Integer(required=True, default=0)
    pin_x = fields.Float(required=True, help='Fraction across the image, 0..1.')
    pin_y = fields.Float(required=True, help='Fraction down the image, 0..1.')
    note = fields.Text(required=True, help='The instructional note shown when a staff member taps this pin.')

    _sql_constraints = [
        ('pin_x_range', 'CHECK(pin_x >= 0 AND pin_x <= 1)', 'A pin X coordinate must be between 0 and 1.'),
        ('pin_y_range', 'CHECK(pin_y >= 0 AND pin_y <= 1)', 'A pin Y coordinate must be between 0 and 1.'),
    ]

    @api.constrains('note', 'step_id')
    def _check_pin(self):
        for pin in self:
            if not (pin.note and pin.note.strip()):
                raise ValidationError('A note-pin needs a note.')
            # Enforced on the pin itself, so it can't be bypassed by creating or
            # moving a pin under a non-photo step (the parent step's constraint
            # does not reliably re-run for child-side writes).
            if pin.step_id.media_type != 'photo':
                raise ValidationError('Note-pins can only be placed on a photo step.')
