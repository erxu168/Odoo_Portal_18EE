from odoo import api, fields, models
from odoo.exceptions import UserError

from .task_template_line import DAY_PART_SELECTION, MODULE_LINK_SELECTION, _guess_image_mime


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

    # ── Setup guide (mise en place) — snapshot copied from the template at spawn.
    # Each daily line keeps its OWN photo copy (immutable per-day history); the
    # Odoo filestore checksum-dedupes identical bytes. Kept out of normal
    # search_read; the portal serves it as raw bytes via its own route.
    is_setup_guide = fields.Boolean()
    setup_photo = fields.Binary(attachment=True)
    setup_photo_filename = fields.Char()

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
            # res_field must be empty: exclude field-backed attachments (e.g. the
            # setup-guide `setup_photo`) so a reference image never counts as proof.
            rec.photo_uploaded = bool(Attachment.search_count([
                ('res_model', '=', self._name),
                ('res_id', '=', rec.id),
                ('res_field', '=', False),
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
        # Direct attachments (ad-hoc tasks or post-spawn additions).
        # res_field=False excludes field-backed binaries (the setup_photo).
        direct = Attachment.search_read(
            [('res_model', '=', self._name), ('res_id', 'in', line_ids),
             ('res_field', '=', False)],
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
                 ('res_id', 'in', list(tpl_to_list.keys())),
                 ('res_field', '=', False)],
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
    def get_setup_photo(self, line_id, allowed_company_ids=None):
        """Return {filename, mimetype, data_base64} for this daily line's OWN
        snapshot photo, or False. The portal serves this as raw image bytes.

        `allowed_company_ids` scopes access to the line's company — closes the
        IDOR where any authenticated user could fetch any line id's photo."""
        rec = self.sudo().browse(int(line_id))
        if not rec.exists() or not rec.setup_photo:
            return False
        if allowed_company_ids:
            company_id = rec.list_id.company_id.id
            if company_id and company_id not in [int(c) for c in allowed_company_ids]:
                return False
        raw = rec.setup_photo
        return {
            'filename': rec.setup_photo_filename or 'setup.jpg',
            'mimetype': _guess_image_mime(rec.setup_photo_filename),
            'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
        }

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
        # Never serve a field-backed binary (e.g. setup_photo) through the
        # generic attachment fetch — those have their own dedicated route.
        if att.res_field:
            return False
        return {
            'name': att.name,
            'mimetype': att.mimetype or '',
            'data_base64': att.datas and att.datas.decode('ascii') if att.datas else '',
        }

    def _locked_pin_status(self):
        """Flush pending writes, take a row lock on this line (FOR UPDATE), and
        return (total_pins, done_pins) read straight from the DB. Serializes the
        completion decision across concurrent pin toggles and manual completion
        (ORM buffers writes; raw SQL does not auto-flush, hence the flush)."""
        self.env.flush_all()
        self.env.cr.execute(
            'SELECT id FROM krawings_task_list_line WHERE id = %s FOR UPDATE', (self.id,),
        )
        self.env.cr.execute(
            'SELECT COUNT(*), COUNT(*) FILTER (WHERE done) '
            'FROM krawings_task_list_subtask WHERE line_id = %s', (self.id,),
        )
        return self.env.cr.fetchone()

    def _write_completed(self, employee):
        """Attribute + stamp completion. Callers must have already validated the
        gate (pins / photo) under the row lock."""
        if isinstance(employee, int):
            employee = self.env['hr.employee'].sudo().browse(employee)
        self.write({
            'completed_at': fields.Datetime.now(),
            'completed_by_id': employee.id if employee and employee.exists() else False,
            'completed_by_name': employee.name if employee and employee.exists() else False,
        })

    def mark_done(self, employee):
        """Mark this line done, attributed to `employee` (hr.employee record or id).

        For setup-guide lines completion is pin-driven: we take the row lock and
        re-read pin state from the DB, so a manual completion cannot race a
        concurrent uncheck, and reject while any pin is unchecked. There is no
        bypass argument — the auto-complete path only reaches `_write_completed`
        after verifying pins under the same lock."""
        self.ensure_one()
        if self.completed_at:
            return True
        if self.is_setup_guide:
            total, done = self._locked_pin_status()
            self.invalidate_recordset(['completed_at'])
            if self.completed_at:
                return True
            if not total or total != done:
                raise UserError('Finish every setup step before completing this guide.')
        if self.photo_required and not self.photo_uploaded:
            raise UserError('A photo is required before completing this task.')
        self._write_completed(employee)
        return True

    def mark_undone(self):
        self.ensure_one()
        self.write({
            'completed_at': False,
            'completed_by_id': False,
            'completed_by_name': False,
        })
        return True

    def _sync_setup_guide_completion(self, employee):
        """Centralised, locked completion for setup-guide lines. A guide
        auto-completes when it has ≥1 pin, every pin is done, and the photo gate
        is satisfied; it reopens when a pin is unchecked (or the gate fails).

        Called from the subtask-toggle path and the proof-photo upload/delete
        paths. Returns True if the line is now completed.

        Race safety: two staff ticking the final two pins concurrently must not
        leave an all-checked guide stuck pending. We flush pending writes, take a
        row lock on the parent line (FOR UPDATE), then count pin state straight
        from the DB — so the two toggles serialize and the second one sees the
        first's committed tick. Never raises mid-toggle: if the photo gate is
        unmet it simply leaves the line pending."""
        self.ensure_one()
        if not self.is_setup_guide:
            return bool(self.completed_at)
        total, done = self._locked_pin_status()
        self.invalidate_recordset(['completed_at', 'photo_uploaded'])
        all_pins_done = bool(total) and total == done
        photo_ok = (not self.photo_required) or self.photo_uploaded
        if all_pins_done and photo_ok:
            if not self.completed_at:
                # Pins already verified under the lock — complete directly
                # (avoids re-locking through mark_done).
                self._write_completed(employee)
        elif self.completed_at:
            self.mark_undone()
        return bool(self.completed_at)

    def resync_setup_guide(self, employee):
        """Public entry so the portal can re-drive setup-guide completion after a
        proof photo is added or removed (photo-required guides). No-op for
        non-guide lines. (`_sync_setup_guide_completion` is underscore-prefixed
        and therefore not RPC-callable.)"""
        self.ensure_one()
        return self._sync_setup_guide_completion(employee)

    @api.model
    def portal_toggle_subtask(self, line_id, subtask_id, done, employee, allowed_company_ids=None):
        """Portal entry for toggling a subtask/pin. Validates — server-side, inside
        the mutation transaction — that the subtask belongs to `line_id`, that the
        line's company is allowed, and that the list is not a past (read-only) day.
        Returns the resulting line state so the caller can refresh.

        This closes the toggle IDOR: the old route acted on the subtask id alone,
        with no line/company/date boundary."""
        line = self.sudo().browse(int(line_id))
        if not line.exists():
            raise UserError('Task not found.')
        if allowed_company_ids:
            company_id = line.list_id.company_id.id
            if company_id and company_id not in [int(c) for c in allowed_company_ids]:
                raise UserError('Not allowed for this company.')
        if line.list_id.date and line.list_id.date < fields.Date.context_today(self):
            raise UserError('Past task lists are read-only.')
        sub = self.env['krawings.task.list.subtask'].sudo().browse(int(subtask_id))
        if not sub.exists() or sub.line_id.id != line.id:
            raise UserError('Subtask does not belong to this task.')
        sub.toggle(done, employee)
        line.invalidate_recordset(['completed_at'])
        return {
            'is_setup_guide': line.is_setup_guide,
            # Only guides complete via subtask toggles; keep the old contract of
            # reporting no completion for ordinary subtasks.
            'line_completed': bool(line.is_setup_guide and line.completed_at),
        }

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
