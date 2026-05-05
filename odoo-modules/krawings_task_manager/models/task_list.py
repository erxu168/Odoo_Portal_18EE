from odoo import api, fields, models
from odoo.exceptions import UserError


class KrawingsTaskList(models.Model):
    _name = 'krawings.task.list'
    _description = 'Department Daily Task List'
    _order = 'date desc, department_id'

    date = fields.Date(required=True, index=True, default=fields.Date.context_today)
    department_id = fields.Many2one(
        'hr.department', required=True, ondelete='restrict', index=True,
    )
    company_id = fields.Many2one(
        'res.company', related='department_id.company_id', store=True, index=True,
    )
    template_id = fields.Many2one(
        'krawings.task.template', ondelete='set null',
        help='Source template (null if list was created entirely ad-hoc).',
    )
    line_ids = fields.One2many('krawings.task.list.line', 'list_id')
    line_count = fields.Integer(compute='_compute_stats', store=False)
    completed_count = fields.Integer(compute='_compute_stats', store=False)
    completion_rate = fields.Integer(compute='_compute_stats', store=False)
    overdue_count = fields.Integer(compute='_compute_stats', store=False)
    photo_pending_count = fields.Integer(compute='_compute_stats', store=False)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('in_progress', 'In Progress'),
        ('done', 'Done'),
    ], compute='_compute_stats', store=False)

    _sql_constraints = [
        ('uniq_date_department', 'unique(date, department_id)',
         'A task list already exists for this department on this date.'),
    ]

    @api.depends(
        'line_ids', 'line_ids.state', 'line_ids.deadline_datetime',
        'line_ids.photo_required', 'line_ids.photo_uploaded',
    )
    def _compute_stats(self):
        for rec in self:
            total = len(rec.line_ids)
            done = sum(1 for l in rec.line_ids if l.state == 'done')
            overdue = sum(1 for l in rec.line_ids if l.state == 'overdue')
            photo_pending = sum(
                1 for l in rec.line_ids
                if l.photo_required and not l.photo_uploaded
            )
            rec.line_count = total
            rec.completed_count = done
            rec.completion_rate = round(done / total * 100) if total else 0
            rec.overdue_count = overdue
            rec.photo_pending_count = photo_pending
            if total == 0:
                rec.state = 'draft'
            elif done == total:
                rec.state = 'done'
            elif done > 0:
                rec.state = 'in_progress'
            else:
                rec.state = 'draft'

    def name_get(self):
        return [
            (rec.id, f'{rec.department_id.name} — {rec.date}')
            for rec in self
        ]

    def add_ad_hoc_line(self, vals):
        """Helper used by the portal API to add a one-off task to today's or a future list."""
        self.ensure_one()
        if self.date < fields.Date.context_today(self):
            raise UserError('Past task lists are read-only.')
        vals = dict(vals)
        vals.update({
            'list_id': self.id,
            'is_ad_hoc': True,
            'source_template_line_id': False,
        })
        return self.env['krawings.task.list.line'].create(vals)

    @api.model
    def ensure_for_dept_date(self, department_id, target_date):
        """Find or create a list for (department, date). If a template applies on that
        day-of-week, spawn from it; otherwise create an empty list ready for ad-hoc lines."""
        if isinstance(target_date, str):
            target_date = fields.Date.from_string(target_date)
        if target_date < fields.Date.context_today(self):
            raise UserError('Cannot create a list for a past date.')
        existing = self.search([
            ('date', '=', target_date),
            ('department_id', '=', department_id),
        ], limit=1)
        if existing:
            return existing.id
        Template = self.env['krawings.task.template']
        applicable = Template.search([
            ('active', '=', True),
            ('department_id', '=', department_id),
        ])
        for tpl in applicable:
            if tpl.applies_today(target_date):
                spawned = tpl._spawn_for_date(target_date)
                if spawned:
                    return spawned.id
        # No template applies — create an empty list
        return self.create({
            'date': target_date,
            'department_id': department_id,
        }).id
