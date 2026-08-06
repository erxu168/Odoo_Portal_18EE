from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Opening / Service / Closing used to be labels with no time attached, which is
# precisely why a task without its own deadline could never remind anyone —
# nothing in the system knew when Opening ended.
#
# The three periods run BACK TO BACK (owner, 2026-08-06: "there are no gaps
# between mid day and closing"), so they are stored as FOUR BOUNDARIES rather
# than three start/end pairs. Half the fields, and a gap or an overlap becomes
# impossible to express — the only rule left is that the four run in order.
WEEKDAY_SELECTION = [
    ('0', 'Monday'), ('1', 'Tuesday'), ('2', 'Wednesday'), ('3', 'Thursday'),
    ('4', 'Friday'), ('5', 'Saturday'), ('6', 'Sunday'),
]


class KrawingsTaskServiceDay(models.Model):
    """When each part of the working day starts and ends, per restaurant.

    One row with weekday NOT set is the default for every day; a row WITH a
    weekday overrides it for that day (Friday and Saturday closing later, say).
    One model rather than "defaults on res.company + a separate override table",
    so there is a single place to read and no branching over where a value lives.
    """
    _name = 'krawings.task.service.day'
    _description = 'Task Manager service periods (per company, per weekday)'
    _order = 'company_id, weekday'

    company_id = fields.Many2one(
        'res.company', required=True, ondelete='cascade', index=True,
    )
    weekday = fields.Selection(
        WEEKDAY_SELECTION,
        help='Leave empty for the everyday default; set it to override one day.',
    )

    # Float hours, Berlin wall-clock — the same convention as a task's own
    # deadline_time (10.5 = 10:30).
    day_start = fields.Float(default=8.0, required=True)
    opening_end = fields.Float(default=12.0, required=True)
    service_end = fields.Float(default=17.0, required=True)
    day_end = fields.Float(default=23.0, required=True)

    _sql_constraints = [
        ('uniq_company_weekday', 'unique(company_id, weekday)',
         'That day already has service times for this restaurant.'),
    ]

    @api.constrains('day_start', 'opening_end', 'service_end', 'day_end')
    def _check_order(self):
        """The four boundaries must run forwards. Anything else would make a
        period end before it began, and every deadline derived from it nonsense."""
        for rec in self:
            for value, label in (
                (rec.day_start, 'The day start'), (rec.opening_end, 'Opening end'),
                (rec.service_end, 'Service end'), (rec.day_end, 'The day end'),
            ):
                # 24.0 is allowed for a day that ends at midnight.
                if value < 0 or value > 24:
                    raise ValidationError('%s must be between 00:00 and 24:00.' % label)
            if not (rec.day_start < rec.opening_end < rec.service_end < rec.day_end):
                raise ValidationError(
                    'Service times must run in order: day start, then Opening ends, '
                    'then Service ends, then the day ends.'
                )

    @api.model
    def windows_for(self, company_id, target_date):
        """The three periods for one company on one date, as
        {day_part: (start_float, end_float)} — or {} when nothing is configured.

        Returning {} matters: until an owner sets their service times, NO task
        gains an implicit deadline and nothing about today's behaviour changes.
        Guessing times here would silently mark a restaurant's whole list overdue.
        """
        company_id = int(company_id)
        weekday = str(target_date.weekday())
        row = self.sudo().search(
            [('company_id', '=', company_id), ('weekday', '=', weekday)], limit=1,
        ) or self.sudo().search(
            [('company_id', '=', company_id), ('weekday', '=', False)], limit=1,
        )
        if not row:
            return {}
        return {
            'opening': (row.day_start, row.opening_end),
            'mid_day': (row.opening_end, row.service_end),
            'closing': (row.service_end, row.day_end),
        }

    @api.model
    def portal_read(self, company_ids):
        """Every configured row for these companies, for the Settings screen."""
        rows = self.sudo().search([('company_id', 'in', [int(c) for c in company_ids])])
        return [{
            'id': r.id,
            'company_id': r.company_id.id,
            'company_name': r.company_id.name,
            'weekday': r.weekday or '',
            'day_start': r.day_start,
            'opening_end': r.opening_end,
            'service_end': r.service_end,
            'day_end': r.day_end,
        } for r in rows]

    @api.model
    def portal_save(self, company_id, rows):
        """Replace one company's service times with exactly `rows`.

        A whole-set replace rather than per-row patching: the screen always sends
        the complete picture, so a removed day-override genuinely disappears
        instead of lingering invisibly and overriding the default forever.
        """
        company_id = int(company_id)
        existing = self.sudo().search([('company_id', '=', company_id)])
        seen = set()
        for row in (rows or []):
            weekday = str(row.get('weekday') or '') or False
            if weekday and weekday not in dict(WEEKDAY_SELECTION):
                raise ValidationError('Unknown weekday: %s' % weekday)
            vals = {
                'company_id': company_id,
                'weekday': weekday,
                'day_start': float(row.get('day_start') or 0),
                'opening_end': float(row.get('opening_end') or 0),
                'service_end': float(row.get('service_end') or 0),
                'day_end': float(row.get('day_end') or 0),
            }
            match = existing.filtered(lambda r: (r.weekday or False) == weekday)
            if match:
                match[0].write(vals)
                seen.add(match[0].id)
            else:
                seen.add(self.sudo().create(vals).id)
        (existing - self.sudo().browse(list(seen))).unlink()
        return True
