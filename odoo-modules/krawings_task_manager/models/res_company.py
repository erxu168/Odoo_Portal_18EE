from odoo import api, fields, models


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

    # ── End-of-day summary (one evening push to this company's managers) ──────
    kw_task_summary_enabled = fields.Boolean(
        string='End-of-day Summary Enabled',
        default=False,
        help='When on, one recap of the day (done / missed / photos to review) '
             'is pushed to this company\'s managers each evening.',
    )
    kw_task_summary_hour = fields.Float(
        string='End-of-day Summary Hour',
        default=22.5,
        help='Time of day (Europe/Berlin, e.g. 22.5 = 22:30) at or after which '
             'the end-of-day summary is sent. The portal cron sends it on its '
             'first run at or after this time, once per day.',
    )
    kw_task_summary_last_sent = fields.Date(
        string='End-of-day Summary Last Sent',
        help='Date the summary was last sent — the cron uses it to send at most '
             'once per day.',
    )

    _sql_constraints = [
        ('kw_task_spawn_hour_range',
         'CHECK(kw_task_spawn_hour >= 0 AND kw_task_spawn_hour <= 23)',
         'The task list spawn hour must be between 0 and 23.'),
        ('kw_task_summary_hour_range',
         'CHECK(kw_task_summary_hour >= 0 AND kw_task_summary_hour < 24)',
         'The end-of-day summary hour must be between 0 and 24.'),
    ]

    @api.model
    def portal_claim_summary(self, company_id, date_str):
        """Atomically claim today's end-of-day summary for a company: returns
        True EXACTLY ONCE per date (row-locks the company and advances
        kw_task_summary_last_sent), so overlapping cron runs never double-send.
        Returns False if already sent for that date or the company is gone."""
        company_id = int(company_id)
        self.env.cr.execute(
            'SELECT kw_task_summary_last_sent FROM res_company WHERE id = %s FOR UPDATE',
            (company_id,),
        )
        row = self.env.cr.fetchone()
        if not row:
            return False
        target = fields.Date.to_date(date_str)
        last = row[0]  # a date or None
        if last and last >= target:
            return False
        self.browse(company_id).kw_task_summary_last_sent = target
        return True
