from odoo import fields, models


DAY_PART_SELECTION = [
    ('opening', 'Opening'),
    ('mid_day', 'Mid-day'),
    ('closing', 'Closing'),
]

MODULE_LINK_SELECTION = [
    ('none', 'None'),
    ('inventory', 'Inventory'),
    ('purchase', 'Purchase'),
    ('pos', 'Point of Sale'),
    ('manufacturing', 'Manufacturing'),
]


class KrawingsTaskTemplateLine(models.Model):
    _name = 'krawings.task.template.line'
    _description = 'Department Task Template Line'
    _order = 'day_part, sequence, id'

    template_id = fields.Many2one(
        'krawings.task.template', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    day_part = fields.Selection(DAY_PART_SELECTION, required=True, default='opening')
    deadline_time = fields.Float(
        help='Time of day this task must be done by (24h, e.g. 10.5 = 10:30). Leave empty for no deadline.',
    )
    photo_required = fields.Boolean()
    module_link_type = fields.Selection(MODULE_LINK_SELECTION, default='none')
    subtask_ids = fields.One2many(
        'krawings.task.template.subtask', 'line_id', copy=True,
    )
