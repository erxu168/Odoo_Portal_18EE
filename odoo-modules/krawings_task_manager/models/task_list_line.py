from odoo import api, fields, models
from odoo.exceptions import UserError

from .task_template_line import DAY_PART_SELECTION, MODULE_LINK_SELECTION


class KrawingsTaskListLine(models.Model):
    _name = 'krawings.task.list.line'
    _description = 'Department Daily Task List Line'
    _order = 'day_part, sequence, id'

    list_id = fields.Many2one(
        'krawings.task.list', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    day_part = fields.Selection(DAY_PART_SELECTION, required=True, default='opening')
    deadline_datetime = fields.Datetime()
    photo_required = fields.Boolean()
    photo_instructions = fields.Char(
        help='Hint shown to staff above the photo upload button.',
    )
    module_link_type = fields.Selection(MODULE_LINK_SELECTION, default='none')

    completed_at = fields.Datetime(readonly=True)
    completed_by_id = fields.Many2one('hr.employee', readonly=True, ondelete='set null')
    completed_by_name = fields.Char(
        readonly=True,
        help='Denormalized employee name preserved for history.',
    )

    is_ad_hoc = fields.Boolean(default=False, readonly=True)
    source_template_line_id = fields.Many2one(
        'krawings.task.template.line', ondelete='set null', readonly=True,
    )

    note = fields.Text(
        help='Free-text note left by the staff doing this task '
             '(e.g. "ran out of bleach", "fryer making noise").',
    )
    note_at = fields.Datetime(readonly=True)
    note_by_id = fields.Many2one('hr.employee', readonly=True, ondelete='set null')
    note_by_name = fields.Char(
        readonly=True,
        help='Denormalized employee name preserved for history.',
    )

    subtask_ids = fields.One2many('krawings.task.list.subtask', 'line_id')
    photo_uploaded = fields.Boolean(compute='_compute_photo_uploaded', store=False)
    state = fields.Selection([
        ('pending', 'Pending'),
        ('done', 'Done'),
        ('overdue', 'Overdue'),
    ], compute='_compute_state', store=False)

    @api.depends('completed_at', 'deadline_datetime')
    def _compute_state(self):
        now = fields.Datetime.now()
        for rec in self:
            if rec.completed_at:
                rec.state = 'done'
            elif rec.deadline_datetime and rec.deadline_datetime < now:
                rec.state = 'overdue'
            else:
                rec.state = 'pending'

    def _compute_photo_uploaded(self):
        Attachment = self.env['ir.attachment']
        for rec in self:
            rec.photo_uploaded = bool(Attachment.search_count([
                ('res_model', '=', self._name),
                ('res_id', '=', rec.id),
            ])) if rec.id else False

    @api.model
    def list_attachments(self, line_ids):
        """Return [{id, line_id, name, mimetype, file_size, scope}] for the given list lines.
        Each line's attachments come from two places:
          - ir.attachment records linked directly to the list line (ad-hoc additions)
          - ir.attachment records linked to the line's source template line, if any
        Scope is 'task' for direct or 'template' for inherited."""
        if not line_ids:
            return []
        lines = self.sudo().browse(line_ids)
        tpl_to_list = {}  # template_line_id -> [list_line_id, ...]
        for l in lines:
            if l.source_template_line_id:
                tpl_to_list.setdefault(l.source_template_line_id.id, []).append(l.id)
        Attachment = self.env['ir.attachment'].sudo()
        out = []
        # Direct attachments (ad-hoc tasks or post-spawn additions)
        direct = Attachment.search_read(
            [('res_model', '=', self._name), ('res_id', 'in', line_ids)],
            ['id', 'res_id', 'name', 'mimetype', 'file_size'],
            order='id asc',
        )
        for r in direct:
            out.append({
                'id': r['id'],
                'line_id': r['res_id'],
                'name': r['name'],
                'mimetype': r.get('mimetype') or '',
                'file_size': r.get('file_size') or 0,
                'scope': 'task',
            })
        # Inherited from template
        if tpl_to_list:
            tpl = Attachment.search_read(
                [('res_model', '=', 'krawings.task.template.line'),
                 ('res_id', 'in', list(tpl_to_list.keys()))],
                ['id', 'res_id', 'name', 'mimetype', 'file_size'],
                order='id asc',
            )
            for r in tpl:
                for list_line_id in tpl_to_list[r['res_id']]:
                    out.append({
                        'id': r['id'],
                        'line_id': list_line_id,
                        'name': r['name'],
                        'mimetype': r.get('mimetype') or '',
                        'file_size': r.get('file_size') or 0,
                        'scope': 'template',
                    })
        return out

    def add_attachment(self, name, data_base64, mimetype=False):
        """Attach a file directly to this list line (ad-hoc, doesn't touch the template)."""
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

    @api.model
    def get_attachment_data(self, attachment_id):
        """Fetch the raw base64 payload of an attachment, scoped to a task list line
        or its source template line (so staff can only fetch attachments they can
        legitimately view via the task manager)."""
        att = self.env['ir.attachment'].sudo().browse(int(attachment_id))
        if not att.exists():
            return False
        if att.res_model not in (self._name, 'krawings.task.template.line'):
            return False
        return {
            'name': att.name,
            'mimetype': att.mimetype or '',
            'data_base64': att.datas and att.datas.decode('ascii') if att.datas else '',
        }

    def mark_done(self, employee):
        """Mark this line done, attributed to `employee` (hr.employee record or id)."""
        self.ensure_one()
        if self.completed_at:
            return True
        if self.photo_required and not self.photo_uploaded:
            raise UserError('A photo is required before completing this task.')
        if isinstance(employee, int):
            employee = self.env['hr.employee'].sudo().browse(employee)
        self.write({
            'completed_at': fields.Datetime.now(),
            'completed_by_id': employee.id if employee and employee.exists() else False,
            'completed_by_name': employee.name if employee and employee.exists() else False,
        })
        return True

    def mark_undone(self):
        self.ensure_one()
        self.write({
            'completed_at': False,
            'completed_by_id': False,
            'completed_by_name': False,
        })
        return True

    def set_note(self, note, employee):
        """Write the free-text note, attributing it to `employee` (hr.employee record or id).
        An empty/whitespace-only note clears the field and its audit metadata."""
        self.ensure_one()
        text = (note or '').strip()
        if isinstance(employee, int):
            employee = self.env['hr.employee'].sudo().browse(employee)
        if not text:
            self.write({
                'note': False,
                'note_at': False,
                'note_by_id': False,
                'note_by_name': False,
            })
            return True
        self.write({
            'note': text,
            'note_at': fields.Datetime.now(),
            'note_by_id': employee.id if employee and employee.exists() else False,
            'note_by_name': employee.name if employee and employee.exists() else False,
        })
        return True
