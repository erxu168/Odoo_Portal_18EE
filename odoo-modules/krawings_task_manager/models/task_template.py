import logging
from datetime import datetime, time

import psycopg2
import pytz

from odoo import api, fields, models
from odoo.exceptions import UserError

from .recurrence import applies_on, rule_from_record

_logger = logging.getLogger(__name__)

# Business timezone for all task scheduling. Deliberately fixed rather than
# derived from the server / cron user / RPC context, so spawn timing and
# deadline conversion cannot drift when any of those run in UTC.
BERLIN_TZ = pytz.timezone('Europe/Berlin')


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
    def spawn_today_lists(self):
        """Public RPC entry: spawn today's lists for every department. Safe to
        call from the portal (manager Spawn button). Idempotent — calling
        again does not duplicate today's lists. A manual click means "spawn
        now", so the per-company spawn hour is ignored."""
        return self._spawn_daily_task_lists(force=True)

    @api.model
    def _cron_spawn_daily_task_lists(self):
        """Cron entry (runs hourly): spawn today's lists for every department
        whose company's configured spawn hour (Europe/Berlin) has been
        reached. Hourly + idempotent makes this self-healing — a run missed
        while the server was down is caught up on the next pass, and DST
        shifts need no special handling because the gate is evaluated in
        local time. sudo() so an internal scheduled job covers every
        restaurant regardless of the cron user's company context."""
        return self.sudo()._spawn_daily_task_lists(force=False)

    @api.model
    def _berlin_now(self):
        """Current wall-clock time in the business timezone (Europe/Berlin)."""
        return fields.Datetime.now().replace(tzinfo=pytz.UTC).astimezone(BERLIN_TZ)

    @api.model
    def _spawn_daily_task_lists(self, force=False):
        """Spawn today's (Europe/Berlin) lists for every department that has
        at least one active template. With force=False, a department is only
        processed once local time has reached its company's
        ``kw_task_spawn_hour`` (default 2 = 02:00)."""
        berlin_now = self._berlin_now()
        today = berlin_now.date()
        TaskList = self.env['krawings.task.list']
        # Group by department to avoid spawning the same list twice when a
        # department has multiple active templates.
        depts = self.env['hr.department']
        for tpl in self.search([('active', '=', True)]):
            depts |= tpl.department_id
        # One batched query for today's existing lists instead of one per
        # department on every hourly pass.
        have_today = {
            rec['department_id'][0]
            for rec in TaskList.search_read([('date', '=', today)], ['department_id'])
            if rec.get('department_id')
        }
        spawned = 0
        skipped = 0
        waiting = 0
        for dept in depts:
            if not force:
                if not dept.company_id:
                    _logger.warning(
                        '[krawings_task_manager] department %s (%s) has no company; '
                        'using default spawn hour 2 — fix the department assignment',
                        dept.id, dept.name,
                    )
                # Integer field: an unset value reads as 0, which is a valid
                # hour (midnight) — only a missing company falls back to 2.
                spawn_hour = dept.company_id.kw_task_spawn_hour if dept.company_id else 2
                if berlin_now.hour < spawn_hour:
                    waiting += 1
                    continue
            if dept.id in have_today:
                skipped += 1
                continue
            new_list = self._build_list_for_dept_date(dept, today)
            if new_list:
                spawned += 1
        _logger.info(
            '[krawings_task_manager] spawn pass complete (%s): %s spawned, %s already existed, %s before spawn hour',
            'manual' if force else 'cron', spawned, skipped, waiting,
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
        # Fixed business timezone: deadline times entered on template lines
        # mean Berlin wall-clock, regardless of which user's context (cron
        # user, portal service account, …) executes the spawn.
        tz = BERLIN_TZ

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
                    # Setup-guide snapshot (D4): each daily line keeps its own copy
                    # of every reference photo + the pins; photo sequences are
                    # preserved so pin_photo_seq needs no remapping. The
                    # filestore checksum-dedupes identical photo bytes.
                    'is_setup_guide': tline.is_setup_guide,
                    'setup_photo_ids': [
                        (0, 0, {
                            'sequence': p.sequence,
                            'image': p.image,
                            'filename': p.filename or False,
                        })
                        for p in tline.setup_photo_ids
                    ],
                    'subtask_ids': [
                        (0, 0, {
                            'name': st.name,
                            'sequence': st.sequence,
                            'pin_photo_seq': st.pin_photo_seq,
                            'pin_x': st.pin_x,
                            'pin_y': st.pin_y,
                        })
                        for st in tline.subtask_ids
                    ],
                }))
                if chosen_template is None:
                    chosen_template = tpl

        # Even if no lines fire we still create an empty list so manager
        # ad-hoc additions and "no list yet" UX have a record to attach to.
        # The savepoint makes the check-then-create genuinely idempotent
        # under concurrency: if the hourly cron and the portal's manual
        # Spawn button race, the loser hits the uniq_date_department
        # constraint and treats it as "already exists".
        try:
            with self.env.cr.savepoint():
                return TaskList.create({
                    'date': target_date,
                    'department_id': department.id,
                    'template_id': chosen_template.id if chosen_template else False,
                    'line_ids': line_vals,
                })
        except psycopg2.IntegrityError:
            _logger.info(
                '[krawings_task_manager] concurrent spawn for dept %s on %s — '
                'another worker created the list first',
                department.id, target_date,
            )
            return False

    def _spawn_for_date(self, target_date):
        """Compatibility helper retained for callers that still expect a
        per-template spawn entry-point. Internally delegates to the
        department-level builder so all active templates contribute."""
        self.ensure_one()
        return self._build_list_for_dept_date(self.department_id, target_date)

    def action_spawn_today(self):
        """Manual trigger from form view."""
        today = self._berlin_now().date()
        any_spawned = False
        for tpl in self:
            if self._build_list_for_dept_date(tpl.department_id, today):
                any_spawned = True
        if not any_spawned:
            raise UserError('No new list spawned (already exists for this department).')
        return True
