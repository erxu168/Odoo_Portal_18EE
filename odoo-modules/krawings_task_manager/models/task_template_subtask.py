from odoo import fields, models


class KrawingsTaskTemplateSubtask(models.Model):
    _name = 'krawings.task.template.subtask'
    _description = 'Department Task Template Subtask'
    _order = 'sequence, id'

    line_id = fields.Many2one(
        'krawings.task.template.line', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
