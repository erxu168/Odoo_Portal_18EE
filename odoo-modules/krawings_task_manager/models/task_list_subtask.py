from odoo import api, fields, models
from odoo.exceptions import ValidationError


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

    @api.constrains('pin_x', 'pin_y')
    def _check_pin_bounds(self):
        for rec in self:
            for val in (rec.pin_x, rec.pin_y):
                if val < 0.0 or val > 1.0:
                    raise ValidationError('Pin coordinates must be between 0 and 1.')

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
        # On a setup guide, ticking/unticking a pin drives the parent line's
        # completion. Return the resulting line state so the portal can refresh.
        line = self.line_id
        if line.is_setup_guide:
            line._sync_setup_guide_completion(employee)
            return {'is_setup_guide': True, 'line_completed': bool(line.completed_at)}
        return {'is_setup_guide': False, 'line_completed': False}
