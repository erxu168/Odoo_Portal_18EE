import logging
from datetime import date, datetime, time, timedelta

import pytz

from odoo import api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


WEEKDAY_FIELDS = ['day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun']


class KrawingsTaskTemplate(models.Model):
    _name = 'krawings.task.template'
    _description = 'Department Task Template'
    _order = 'department_id, name'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    department_id = fields.Many2one(
        'hr.department', required=True, ondelete='cascade', index=True,
    )
    company_id = fields.Many2one(
        'res.company', related='department_id.company_id', store=True, index=True,
    )

    day_mon = fields.Boolean('Monday')
    day_tue = fields.Boolean('Tuesday')
    day_wed = fields.Boolean('Wednesday')
    day_thu = fields.Boolean('Thursday')
    day_fri = fields.Boolean('Friday')
    day_sat = fields.Boolean('Saturday')
    day_sun = fields.Boolean('Sunday')

    line_ids = fields.One2many(
        'krawings.task.template.line', 'template_id', string='Tasks', copy=True,
    )
    line_count = fields.Integer(compute='_compute_line_count')

    @api.depends('line_ids')
    def _compute_line_count(self):
        for tpl in self:
            tpl.line_count = len(tpl.line_ids)

    def applies_today(self, target_date):
        """True if this template should spawn on `target_date`."""
        self.ensure_one()
        return self[WEEKDAY_FIELDS[target_date.weekday()]]

    @api.model
    def _cron_spawn_daily_task_lists(self):
        """Cron entry: spawn today's lists for every applicable template."""
        today = fields.Date.context_today(self)
        spawned = 0
        skipped = 0
        for tpl in self.search([('active', '=', True)]):
            if not tpl.applies_today(today):
                continue
            try:
                created = tpl._spawn_for_date(today)
                if created:
                    spawned += 1
                else:
                    skipped += 1
            except Exception:
                _logger.exception('[krawings_task_manager] failed to spawn for template %s', tpl.id)
        _logger.info(
            '[krawings_task_manager] cron complete: %s spawned, %s skipped',
            spawned, skipped,
        )

    def _spawn_for_date(self, target_date):
        """Idempotent: returns the krawings.task.list (created or existing)."""
        self.ensure_one()
        TaskList = self.env['krawings.task.list']
        existing = TaskList.search([
            ('date', '=', target_date),
            ('department_id', '=', self.department_id.id),
        ], limit=1)
        if existing:
            return False
        tz = pytz.timezone(self.env.user.tz or 'Europe/Berlin')
        line_vals = []
        for tline in self.line_ids:
            deadline_dt = False
            if tline.deadline_time:
                hours = int(tline.deadline_time)
                minutes = int(round((tline.deadline_time - hours) * 60))
                local_dt = tz.localize(datetime.combine(target_date, time(hours, minutes)))
                deadline_dt = local_dt.astimezone(pytz.UTC).replace(tzinfo=None)
            line_vals.append((0, 0, {
                'name': tline.name,
                'sequence': tline.sequence,
                'day_part': tline.day_part,
                'deadline_datetime': deadline_dt,
                'photo_required': tline.photo_required,
                'photo_instructions': tline.photo_instructions or False,
                'module_link_type': tline.module_link_type,
                'is_ad_hoc': False,
                'source_template_line_id': tline.id,
                'subtask_ids': [
                    (0, 0, {'name': st.name, 'sequence': st.sequence})
                    for st in tline.subtask_ids
                ],
            }))
        return TaskList.create({
            'date': target_date,
            'department_id': self.department_id.id,
            'template_id': self.id,
            'line_ids': line_vals,
        })

    def action_spawn_today(self):
        """Manual trigger from form view."""
        today = fields.Date.context_today(self)
        spawned = 0
        for tpl in self:
            if tpl.applies_today(today) and tpl._spawn_for_date(today):
                spawned += 1
        if not spawned:
            raise UserError('No new lists spawned (already exist or template does not apply today).')
        return True
