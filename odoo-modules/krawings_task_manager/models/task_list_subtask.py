from odoo import fields, models


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
        return True
