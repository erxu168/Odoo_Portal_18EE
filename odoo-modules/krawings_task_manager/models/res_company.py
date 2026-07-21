from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    kw_task_spawn_hour = fields.Integer(
        string='Daily Task List Spawn Hour',
        default=2,
        help='Hour of day (0-23, Europe/Berlin) at which the daily department '
             'task lists are created for this company. The spawn cron runs '
             'hourly and creates the lists on the first run at or after this '
             'hour, so a missed run is caught up automatically.',
    )

    _sql_constraints = [
        ('kw_task_spawn_hour_range',
         'CHECK(kw_task_spawn_hour >= 0 AND kw_task_spawn_hour <= 23)',
         'The task list spawn hour must be between 0 and 23.'),
    ]
