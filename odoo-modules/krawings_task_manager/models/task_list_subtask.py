from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError


class KrawingsTaskListSubtask(models.Model):
    _name = 'krawings.task.list.subtask'
    _description = 'Department Daily Task Subtask'
    _order = 'sequence, id'

    line_id = fields.Many2one(
        'krawings.task.list.line', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    done = fields.Boolean(default=False)
    toggled_at = fields.Datetime(readonly=True)
    toggled_by_id = fields.Many2one('hr.employee', readonly=True, ondelete='set null')

    # ── Setup-guide pin (copied from the template subtask at spawn) ──────
    pin_photo_seq = fields.Integer(
        default=0,
        help='Sequence of the setup photo this pin sits on (multi-photo guides).',
    )
    pin_x = fields.Float(help='0.0–1.0, fraction across the reference image.')
    pin_y = fields.Float(help='0.0–1.0, fraction down the reference image.')

    # Set by the 18.0.7.0.0 migration on daily pin-subtasks that were converted
    # into guided-tutorial note-pins. Retained for audit (their done/toggled_at
    # history), but excluded from the portal and no longer toggleable.
    legacy_guide_pin = fields.Boolean(default=False, readonly=True)

    @api.constrains('pin_x', 'pin_y')
    def _check_pin_bounds(self):
        for rec in self:
            for val in (rec.pin_x, rec.pin_y):
                if val < 0.0 or val > 1.0:
                    raise ValidationError('Pin coordinates must be between 0 and 1.')

    def _legacy_locked(self):
        """Converted guide pins are immutable audit rows. sudo (spawn/migration)
        may still touch them."""
        return not self.env.su and any(s.legacy_guide_pin for s in self)

    def write(self, vals):
        # Allow only flipping the legacy flag itself (the migration marks rows);
        # block any staff/portal mutation of a converted pin.
        if set(vals) - {'legacy_guide_pin'} and self._legacy_locked():
            raise UserError('This item is part of a converted guide and can no longer be changed.')
        return super().write(vals)

    def unlink(self):
        if self._legacy_locked():
            raise UserError('This converted guide item cannot be deleted.')
        return super().unlink()

    def toggle(self, done, employee):
        self.ensure_one()
        if isinstance(employee, int):
            emp_id = employee
        elif employee and hasattr(employee, 'id'):
            emp_id = employee.id
        else:
            emp_id = False
        self.write({
            'done': bool(done),
            'toggled_at': fields.Datetime.now(),
            'toggled_by_id': emp_id,
        })
        # Subtasks are ordinary checklist items — they NEVER complete the task.
        # (Guided-tutorial note-pins are a separate model, purely instructional,
        # and never touch completion.) Staff complete the task via the normal
        # control only.
        return {'is_setup_guide': False, 'line_completed': False}
