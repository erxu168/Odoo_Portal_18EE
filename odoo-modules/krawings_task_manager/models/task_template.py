import logging
from datetime import datetime, time

import pytz

from odoo import api, fields, models
from odoo.exceptions import UserError

from .recurrence import applies_on, rule_from_record

_logger = logging.getLogger(__name__)


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

    line_ids = fields.One2many(
        'krawings.task.template.line', 'template_id', string='Tasks', copy=True,
    )
    line_count = fields.Integer(compute='_compute_line_count')

    @api.depends('line_ids')
    def _compute_line_count(self):
        for tpl in self:
            tpl.line_count = len(tpl.line_ids)

    @api.model
    def _cron_spawn_daily_task_lists(self):
        """Cron entry: spawn today's lists for every department that has at
        least one applicable template line firing today."""
        today = fields.Date.context_today(self)
        TaskList = self.env['krawings.task.list']
        # Group by department to avoid spawning the same list twice when a
        # department has multiple active templates.
        depts = self.env['hr.department']
        for tpl in self.search([('active', '=', True)]):
            depts |= tpl.department_id
        spawned = 0
        skipped = 0
        for dept in depts:
            existing = TaskList.search([('date', '=', today), ('department_id', '=', dept.id)], limit=1)
            if existing:
                skipped += 1
                continue
            new_list = self._build_list_for_dept_date(dept, today)
            if new_list:
                spawned += 1
        _logger.info(
            '[krawings_task_manager] cron complete: %s spawned, %s skipped',
            spawned, skipped,
        )

    @api.model
    def _build_list_for_dept_date(self, department, target_date):
        """Materialise a krawings.task.list for (department, date) by iterating
        every active template's lines and asking the recurrence engine which
        ones fire on that date. Returns the new list record, or False if the
        list already exists or no lines fire."""
        TaskList = self.env['krawings.task.list']
        TaskTemplate = self.env['krawings.task.template']
        existing = TaskList.search([
            ('date', '=', target_date),
            ('department_id', '=', department.id),
        ], limit=1)
        if existing:
            return False

        templates = TaskTemplate.search([
            ('active', '=', True),
            ('department_id', '=', department.id),
        ])
        tz = pytz.timezone(self.env.user.tz or 'Europe/Berlin')

        line_vals = []
        chosen_template = None
        for tpl in templates:
            for tline in tpl.line_ids:
                if not applies_on(rule_from_record(tline), target_date):
                    continue
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
                if chosen_template is None:
                    chosen_template = tpl

        # Even if no lines fire we still create an empty list so manager
        # ad-hoc additions and "no list yet" UX have a record to attach to.
        return TaskList.create({
            'date': target_date,
            'department_id': department.id,
            'template_id': chosen_template.id if chosen_template else False,
            'line_ids': line_vals,
        })

    def _spawn_for_date(self, target_date):
        """Compatibility helper retained for callers that still expect a
        per-template spawn entry-point. Internally delegates to the
        department-level builder so all active templates contribute."""
        self.ensure_one()
        return self._build_list_for_dept_date(self.department_id, target_date)

    def action_spawn_today(self):
        """Manual trigger from form view."""
        today = fields.Date.context_today(self)
        any_spawned = False
        for tpl in self:
            if self._build_list_for_dept_date(tpl.department_id, today):
                any_spawned = True
        if not any_spawned:
            raise UserError('No new list spawned (already exists for this department).')
        return True
