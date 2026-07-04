from odoo import api, fields, models


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

RECURRENCE_TYPE_SELECTION = [
    ('once', 'One-off date'),
    ('daily', 'Daily'),
    ('weekly', 'Weekly'),
    ('monthly', 'Monthly'),
    ('yearly', 'Yearly'),
]

RECURRENCE_END_TYPE_SELECTION = [
    ('never', 'Never'),
    ('on_date', 'On a date'),
    ('after_count', 'After N occurrences'),
]

RECURRENCE_MONTHLY_MODE_SELECTION = [
    ('day_of_month', 'On a day of the month'),
    ('weekday_of_month', 'On the Nth weekday of the month'),
]


class KrawingsTaskTemplateLine(models.Model):
    _name = 'krawings.task.template.line'
    _description = 'Department Task Template Line'
    _order = 'day_part, sequence, id'

    template_id = fields.Many2one(
        'krawings.task.template', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    details = fields.Text(
        help='Manager-authored instructions / description shown to staff and on '
             'the KDS. Distinct from the staff note left while doing the task.',
    )
    sequence = fields.Integer(default=10)
    day_part = fields.Selection(DAY_PART_SELECTION, required=True, default='opening')
    deadline_time = fields.Float(
        help='Time of day this task must be done by (24h, e.g. 10.5 = 10:30). Leave empty for no deadline.',
    )
    photo_required = fields.Boolean()
    photo_instructions = fields.Char(
        help='Hint shown to staff above the photo upload button when photo_required is set.',
    )
    module_link_type = fields.Selection(MODULE_LINK_SELECTION, default='none')
    subtask_ids = fields.One2many(
        'krawings.task.template.subtask', 'line_id', copy=True,
    )

    # ── Recurrence rule (per task) ───────────────────────────────────────
    # Keys here are read by recurrence.applies_on() via rule_from_record().
    recurrence_type = fields.Selection(
        RECURRENCE_TYPE_SELECTION, required=True, default='daily',
    )
    recurrence_interval = fields.Integer(
        default=1, help='Repeat every N units (days/weeks/months/years).',
    )
    recurrence_start_date = fields.Date(
        required=True, default=fields.Date.context_today,
        help='First day the rule is effective. Anchors weekly/monthly/yearly counters.',
    )
    recurrence_end_type = fields.Selection(
        RECURRENCE_END_TYPE_SELECTION, required=True, default='never',
    )
    recurrence_end_date = fields.Date()
    recurrence_count = fields.Integer(help='Number of occurrences when end_type=after_count.')

    recurrence_one_off_date = fields.Date(help='Used when type=once.')

    # weekly: comma-separated weekday indices, Mon=0..Sun=6
    recurrence_weekdays = fields.Char(default='0,1,2,3,4,5,6')

    # monthly + yearly: which day of the month to fire on
    recurrence_monthly_mode = fields.Selection(
        RECURRENCE_MONTHLY_MODE_SELECTION, default='day_of_month',
    )
    recurrence_day_of_month = fields.Integer(
        default=1, help='1..31, or -1 for "last day of the month".',
    )
    recurrence_weekday_pos = fields.Integer(
        default=1, help='1..4 = first..fourth occurrence, -1 = last occurrence.',
    )
    recurrence_weekday = fields.Integer(
        default=0, help='Mon=0..Sun=6 (used when monthly_mode=weekday_of_month).',
    )
    # yearly only
    recurrence_month = fields.Integer(default=1, help='1..12 (yearly only).')

    exception_ids = fields.One2many(
        'krawings.task.template.line.exception', 'line_id',
        copy=True, help='Specific dates the rule should NOT fire even if it otherwise would.',
    )

    @api.model
    def list_attachments(self, line_ids):
        """Return [{id, line_id, name, mimetype, file_size}] for the given lines."""
        if not line_ids:
            return []
        recs = self.env['ir.attachment'].sudo().search_read(
            [('res_model', '=', self._name), ('res_id', 'in', line_ids)],
            ['id', 'res_id', 'name', 'mimetype', 'file_size'],
            order='id asc',
        )
        return [
            {
                'id': r['id'],
                'line_id': r['res_id'],
                'name': r['name'],
                'mimetype': r.get('mimetype') or '',
                'file_size': r.get('file_size') or 0,
            }
            for r in recs
        ]

    def add_attachment(self, name, data_base64, mimetype=False):
        """Attach a file to this template line. Returns the new attachment id."""
        self.ensure_one()
        att = self.env['ir.attachment'].sudo().create({
            'name': name,
            'res_model': self._name,
            'res_id': self.id,
            'type': 'binary',
            'datas': data_base64,
            'mimetype': mimetype or False,
        })
        return att.id


class KrawingsTaskTemplateLineException(models.Model):
    _name = 'krawings.task.template.line.exception'
    _description = 'Recurrence exception (skip this date)'
    _order = 'date'

    line_id = fields.Many2one(
        'krawings.task.template.line', required=True, ondelete='cascade', index=True,
    )
    date = fields.Date(required=True)
    note = fields.Char(help='Optional reason — purely informational.')

    _sql_constraints = [
        ('uniq_line_date', 'unique(line_id, date)',
         'A line cannot have the same exception date twice.'),
    ]
