from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .task_template_line import (
    DAY_PART_SELECTION,
    MAX_MANAGER_NOTE,
    MAX_RICH_TEXT_BYTES,
    MODULE_LINK_SELECTION,
    rich_text_to_plain,
    sanitize_rich_text,
    _guess_image_mime,
)

#: Rows returned per person in the accountability drawer. Beyond this the screen
#: says how many were left out rather than quietly ending — a report people are
#: judged by must not truncate in silence.
DETAIL_LIMIT = 500


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
    # True when this time came from the PERIOD's end rather than a time the
    # manager typed on the task. The screens say so — "By 12:00 · end of
    # Opening" instead of a deadline that appears from nowhere.
    deadline_is_implicit = fields.Boolean(readonly=True)
    # When we last told a manager this task was overdue. Drives "alert once,
    # then repeat hourly while it is still outstanding" — without it a checker
    # running every 15 minutes would send the same task four times an hour.
    overdue_alerted_at = fields.Datetime(readonly=True)
    photo_required = fields.Boolean()
    photo_instructions = fields.Char(
        help='Hint shown to staff above the photo upload button.',
    )
    # Snapshot of the template line's manager_note, copied at spawn like every
    # other field here — so clearing it on the template leaves today's already-
    # spawned lists untouched. NOT the same thing as `note` below: this one the
    # manager wrote for staff; `note` is what staff wrote back about today.
    manager_note = fields.Text(
        help='Note from the manager, shown to staff when they open this task.',
    )
    module_link_type = fields.Selection(MODULE_LINK_SELECTION, default='none')

    completed_at = fields.Datetime(readonly=True)
    completed_by_id = fields.Many2one('hr.employee', readonly=True, ondelete='set null')
    completed_by_name = fields.Char(
        readonly=True,
        help='Denormalized employee name preserved for history.',
    )

    # ── Photo review (manager oversight) ─────────────────────────────────
    # A manager can FLAG a proof photo that looks wrong. This is an oversight
    # signal only: it does NOT reopen the task (the task stays done); the staff
    # member is told (portal push) it looked wrong. The manager clears the flag.
    review_flagged = fields.Boolean(default=False, readonly=True)
    review_flag_reason = fields.Char(readonly=True)
    review_flagged_by_id = fields.Many2one('hr.employee', readonly=True, ondelete='set null')
    review_flagged_by_name = fields.Char(readonly=True)
    review_flagged_at = fields.Datetime(readonly=True)

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

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('manager_note'):
                vals['manager_note'] = sanitize_rich_text(vals['manager_note'])
        return super().create(vals_list)

    def write(self, vals):
        # Sanitise on the way IN, on every path — the portal is one caller, but
        # a direct Odoo write or an import is not going to clean this for us,
        # and staff render whatever ends up stored.
        if vals.get('manager_note'):
            vals['manager_note'] = sanitize_rich_text(vals['manager_note'])
        return super().write(vals)

    @api.constrains('manager_note')
    def _check_manager_note(self):
        # Also enforced here, not just on the template: a one-off task is written
        # straight onto the daily list and never passes through a template line.
        for line in self:
            if line.manager_note and len(line.manager_note) > MAX_RICH_TEXT_BYTES:
                raise ValidationError(
                    'That note is too large. Remove some formatting or a very long link.'
                )
            if line.manager_note and len(rich_text_to_plain(line.manager_note)) > MAX_MANAGER_NOTE:
                raise ValidationError(
                    'A note for staff can be at most %d characters.' % MAX_MANAGER_NOTE
                )

    # ── Setup guide (mise en place) — snapshot copied from the template at spawn.
    # Each daily line keeps its OWN photo copies (immutable per-day history); the
    # Odoo filestore checksum-dedupes identical bytes. Photos live on
    # krawings.task.setup.photo, kept out of normal search_read; the portal
    # serves bytes via a dedicated route. The single Binary is LEGACY.
    is_setup_guide = fields.Boolean()
    setup_photo = fields.Binary(attachment=True)         # legacy, no longer written
    setup_photo_filename = fields.Char()                 # legacy, no longer written
    setup_photo_ids = fields.One2many(
        'krawings.task.setup.photo', 'list_line_id',
    )

    # ── Guided tutorial snapshot (copied from the LINKED guide at spawn; only
    # when that guide was PUBLISHED). Immutable per-day history. Purely
    # instructional — never affects completion. Playback reads ONLY these
    # list-owned steps; guide_source_* are audit trail and are NEVER
    # dereferenced for content (the guide may be edited or deleted later). ──
    guide_step_ids = fields.One2many('krawings.task.guide.step', 'list_line_id')
    guide_snapshot_revision = fields.Integer(readonly=True)
    guide_source_id = fields.Many2one(
        'krawings.task.guide', ondelete='set null', readonly=True,
        help='The library guide this snapshot was taken from (audit only).',
    )
    guide_source_name = fields.Char(
        readonly=True,
        help="The guide's name at snapshot time — survives the guide being "
             'renamed or deleted.',
    )
    has_guide = fields.Boolean(compute='_compute_guide', store=True)
    guide_step_count = fields.Integer(compute='_compute_guide', store=True)

    @api.depends('guide_step_ids')
    def _compute_guide(self):
        for rec in self:
            rec.guide_step_count = len(rec.guide_step_ids)
            rec.has_guide = bool(rec.guide_step_ids)

    @api.model
    def portal_read_guide(self, list_line_id, allowed_company_ids=None):
        """Staff: read a daily line's guide snapshot for the player. Media bytes
        come via the step-media route. Fails CLOSED on company scope."""
        line = self.sudo().browse(int(list_line_id))
        if not line.exists():
            return False
        company = line.list_id.company_id
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or not company.id or company.id not in allowed:
            return False
        steps = []
        for s in line.guide_step_ids.sorted('sequence'):
            steps.append({
                'id': s.id,
                'media_type': s.media_type,
                'explanation': s.explanation or '',
                'has_image': bool(s.image),
                'has_pdf': bool(s.pdf_file),
                'pdf_filename': s.pdf_filename or '',
                'youtube_url': s.youtube_url or '',
                'drawings': s.drawings or '',
                'pins': [
                    {'pin_x': p.pin_x, 'pin_y': p.pin_y, 'note': p.note or ''}
                    for p in s.pin_ids.sorted('sequence')
                ],
            })
        return {'line_name': line.name, 'steps': steps}

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
        """LEGACY single-photo read for this daily line: serves the first photo
        row (company-scoped), falling back to the pre-multi-photo Binary for
        un-migrated rows. Multi-photo reads go through
        krawings.task.setup.photo.get_photo('list', line_id, seq)."""
        rec = self.sudo().browse(int(line_id))
        if not rec.exists():
            return False
        first = rec.setup_photo_ids.sorted('sequence')[:1]
        if first:
            return self.env['krawings.task.setup.photo'].get_photo(
                'list', rec.id, first.sequence, allowed_company_ids)
        if not rec.setup_photo:
            return False
        if allowed_company_ids:
            company_id = rec.list_id.company_id.id
            if not company_id or company_id not in [int(c) for c in allowed_company_ids]:
                return False
        raw = rec.setup_photo
        return {
            'filename': rec.setup_photo_filename or 'setup.jpg',
            'mimetype': _guess_image_mime(rec.setup_photo_filename),
            'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
        }

    def _task_attachment_company(self, attachment_id):
        """The company that owns a task attachment, or (False, False).

        Returns (attachment, company_id). Anything that is not a plain
        attachment on a task line — another model, a field-backed binary like
        setup_photo, a missing record — comes back with no company, which every
        caller treats as "refuse".

        Both routes into this file are read-your-own-restaurant paths, and
        neither used to check WHICH restaurant. res_model alone kept people out
        of invoices and contracts; it did nothing to stop one company reading
        (or deleting) another company's task files by guessing an id.
        """
        att = self.env['ir.attachment'].sudo().browse(int(attachment_id))
        if not att.exists():
            return False, False
        if att.res_model not in (self._name, 'krawings.task.template.line'):
            return False, False
        # Never serve a field-backed binary (e.g. setup_photo) through the
        # generic attachment fetch — those have their own dedicated route.
        if att.res_field:
            return False, False
        if att.res_model == self._name:
            owner = self.sudo().browse(att.res_id)
            company = owner.list_id.company_id if owner.exists() else False
        else:
            owner = self.env['krawings.task.template.line'].sudo().browse(att.res_id)
            company = owner.template_id.department_id.company_id if owner.exists() else False
        return att, (company.id if company else False)

    @api.model
    def _attachment_allowed(self, attachment_id, allowed_company_ids):
        """(attachment, ok). Fails CLOSED: no scope passed, or a company outside
        it, is refused — the same shape as portal_read_guide."""
        att, company_id = self._task_attachment_company(attachment_id)
        if not att:
            return False, False
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or not company_id or company_id not in allowed:
            return att, False
        return att, True

    @api.model
    def get_attachment_data(self, attachment_id, allowed_company_ids=None):
        """Fetch the raw base64 payload of an attachment on a task line or its
        source template line. Scoped to the caller's companies; fails CLOSED.

        @api.model is load-bearing: call_kw hands args[0] to browse() as record
        ids for a plain method, so without it this receives the company list as
        its attachment id and raises. That is a 500 on every attachment."""
        att, ok = self._attachment_allowed(attachment_id, allowed_company_ids)
        if not ok:
            return False
        return {
            'name': att.name,
            'mimetype': att.mimetype or '',
            'data_base64': att.datas and att.datas.decode('ascii') if att.datas else '',
        }

    @api.model
    def portal_delete_attachment(self, attachment_id, allowed_company_ids=None):
        """Delete one task attachment, in the caller's companies only.

        The portal used to unlink ir.attachment by id directly, which meant a
        manager could delete ANY attachment in the database — an invoice, a
        signed contract, a payslip — not merely one of their own task files.
        Deletion now goes through the same resolution as the read.
        """
        att, ok = self._attachment_allowed(attachment_id, allowed_company_ids)
        if not ok:
            return False
        att.unlink()
        return True

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

        Completion is manual: staff tick the task. A guided tutorial attached to
        the task is purely instructional and never gates or drives completion.
        The only gate is a required proof photo."""
        self.ensure_one()
        if self.completed_at:
            return True
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

    def resync_setup_guide(self, employee):
        """Compatibility no-op. Guided tutorials never drive completion, so there
        is nothing to re-sync when a proof photo changes. Kept RPC-callable so an
        older portal build during a deploy window does not error; the legacy
        setup-guide→tutorial migration (18.0.7.0.0) clears is_setup_guide."""
        self.ensure_one()
        return bool(self.completed_at)

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
            if not company_id or company_id not in [int(c) for c in allowed_company_ids]:
                raise UserError('Not allowed for this company.')
        if line.list_id.date and line.list_id.date < fields.Date.context_today(self):
            raise UserError('Past task lists are read-only.')
        sub = self.env['krawings.task.list.subtask'].sudo().browse(int(subtask_id))
        if not sub.exists() or sub.line_id.id != line.id:
            raise UserError('Subtask does not belong to this task.')
        if sub.legacy_guide_pin:
            raise UserError('This item is part of a converted guide and can no longer be changed.')
        sub.toggle(done, employee)
        # Subtasks never complete the line; report the line's own (independent)
        # completion so the caller can refresh.
        return {'is_setup_guide': False, 'line_completed': bool(line.completed_at)}

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

    # ── Photo review + end-of-day summary (manager oversight) ────────────
    @api.model
    def _proof_photo_map(self, line_ids):
        """{line_id: [{id, name, mimetype}]} of PROOF photos for the given daily
        lines: direct attachments (res_field empty — excludes field-backed setup
        binaries) that are IMAGES. The image filter keeps reference PDFs / docs
        out of the review feed and photo route (they aren't proof photos)."""
        if not line_ids:
            return {}
        atts = self.env['ir.attachment'].sudo().search_read(
            [('res_model', '=', self._name), ('res_id', 'in', list(line_ids)),
             ('res_field', '=', False), ('mimetype', 'like', 'image/%')],
            ['id', 'res_id', 'name', 'mimetype'], order='id asc',
        )
        out = {}
        for a in atts:
            out.setdefault(a['res_id'], []).append(
                {'id': a['id'], 'name': a['name'], 'mimetype': a.get('mimetype') or ''}
            )
        return out

    @api.model
    def portal_review_feed(self, allowed_company_ids, date_str=None, employee_id=None):
        """Manager oversight feed: completed tasks that carry a PROOF photo for
        `date_str` (default today), in the caller's companies, newest first;
        optionally one staff member. Fails CLOSED without a company scope.
        Returns {stats:{submitted,flagged,looks_good}, items:[...]}."""
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed:
            return {'stats': {'submitted': 0, 'flagged': 0, 'looks_good': 0}, 'items': []}
        domain = [
            ('list_id.company_id', 'in', allowed),
            ('completed_at', '!=', False),
            ('list_id.date', '=', date_str or fields.Date.context_today(self)),
        ]
        if employee_id:
            domain.append(('completed_by_id', '=', int(employee_id)))
        lines = self.sudo().search(domain, order='completed_at desc')
        photos = self._proof_photo_map(lines.ids)
        items = []
        for l in lines:
            atts = photos.get(l.id, [])
            if not atts:
                continue  # only submissions WITH a proof photo
            items.append({
                'line_id': l.id,
                'name': l.name,
                'day_part': l.day_part,
                'completed_by_id': l.completed_by_id.id or False,
                'completed_by_name': l.completed_by_name or (l.completed_by_id.name if l.completed_by_id else ''),
                'completed_at': fields.Datetime.to_string(l.completed_at) if l.completed_at else '',
                'flagged': l.review_flagged,
                'flag_reason': l.review_flag_reason or '',
                'flagged_by_name': l.review_flagged_by_name or '',
                'attachments': atts,
            })
        flagged = sum(1 for i in items if i['flagged'])
        return {
            'stats': {'submitted': len(items), 'flagged': flagged, 'looks_good': len(items) - flagged},
            'items': items,
        }

    @api.model
    def portal_set_photo_flag(self, line_id, flagged, reason=None, employee=None, allowed_company_ids=None):
        """Manager flags/clears a proof photo. Oversight ONLY — never changes the
        task's completion. Company-scoped; a past-day list is read-only. Returns
        {line_id, flagged, reason, completed_by_id} so the route can push the
        redo notice to the staff member who did it."""
        line = self.sudo().browse(int(line_id))
        if not line.exists():
            raise UserError('Task not found.')
        allowed = [int(c) for c in (allowed_company_ids or [])]
        company_id = line.list_id.company_id.id
        if not allowed or not company_id or company_id not in allowed:
            raise UserError('Not allowed for this company.')
        if line.list_id.date and line.list_id.date < fields.Date.context_today(self):
            raise UserError('Past task lists are read-only.')
        # Lock the row so the was-flagged read + write is atomic: two managers
        # flagging the same line at once can't both see False and both alert.
        self.env.flush_all()
        self.env.cr.execute(
            'SELECT review_flagged FROM krawings_task_list_line WHERE id = %s FOR UPDATE',
            (line.id,),
        )
        lockrow = self.env.cr.fetchone()
        was_flagged = bool(lockrow[0]) if lockrow else False
        if flagged:
            # Only a real submission can be flagged: it must be completed AND carry
            # a proof photo (so the staff push actually corresponds to a photo).
            if not line.completed_at:
                raise UserError('Only a completed task can be flagged.')
            if not self._proof_photo_map([line.id]).get(line.id):
                raise UserError('This task has no proof photo to flag.')
            if isinstance(employee, int):
                employee = self.env['hr.employee'].sudo().browse(employee)
            line.write({
                'review_flagged': True,
                'review_flag_reason': (reason or '').strip() or 'Please redo this one.',
                'review_flagged_by_id': employee.id if employee and employee.exists() else False,
                'review_flagged_by_name': employee.name if employee and employee.exists() else False,
                'review_flagged_at': fields.Datetime.now(),
            })
        else:
            line.write({
                'review_flagged': False,
                'review_flag_reason': False,
                'review_flagged_by_id': False,
                'review_flagged_by_name': False,
                'review_flagged_at': False,
            })
        return {
            'line_id': line.id,
            'name': line.name,
            'company_id': company_id,
            'flagged': line.review_flagged,
            # True only on a false→true TRANSITION, so a replay / double-click /
            # two managers flagging the same line never re-alerts the staff member.
            'newly_flagged': bool(flagged and not was_flagged),
            'reason': line.review_flag_reason or '',
            'completed_by_id': line.completed_by_id.id or False,
        }

    @api.model
    def get_review_photo(self, attachment_id, allowed_company_ids=None):
        """Serve a proof photo's bytes for the review screen — scoped: the
        attachment must be a proof photo (res_field empty) on a daily line whose
        company is allowed. Fails CLOSED. {filename, mimetype, data_base64} or False."""
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed:
            return False
        att = self.env['ir.attachment'].sudo().browse(int(attachment_id))
        if not att.exists() or att.res_model != self._name or att.res_field:
            return False
        if not (att.mimetype or '').startswith('image/'):
            return False  # proof photos are images; never serve a doc here
        line = self.sudo().browse(att.res_id)
        if not line.exists():
            return False
        company_id = line.list_id.company_id.id
        if not company_id or company_id not in allowed:
            return False
        raw = att.datas
        return {
            'filename': att.name or 'photo-%s.jpg' % att.id,
            'mimetype': att.mimetype or _guess_image_mime(att.name),
            'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else (raw or ''),
        }

    @api.model
    def portal_overdue_digest(self, company_id, grace_minutes=15, repeat_minutes=60, dates=None):
        """Tasks overdue long enough to shout about, grouped by department.

        CLAIMS as it reads: every line returned is stamped with
        overdue_alerted_at before this returns, so a second checker run (or a
        retry) cannot report the same task again inside the repeat window. The
        caller may therefore send exactly what it receives, with no bookkeeping
        of its own.

        Scoped to the service days that are OPEN right now — normally just
        today, but also yesterday while a day that ends at midnight is still
        inside its grace tail. That window is precisely when the last closing
        tasks of the night become reportable; without it they never are.

        It is still not "yesterday's misses": once yesterday's tail closes it
        drops out, and what is left belongs to last night's summary rather than
        this morning's service. The caller passes the open dates
        (krawings.task.service.day.active_service_dates); today alone is the
        fallback.
        """
        company_id = int(company_id)
        now = fields.Datetime.now()
        grace_cutoff = now - timedelta(minutes=int(grace_minutes))
        repeat_cutoff = now - timedelta(minutes=int(repeat_minutes))
        open_dates = [d for d in (dates or []) if d] or [
            self.env['krawings.task.template']._berlin_now().date()
        ]

        lines = self.sudo().search([
            ('list_id.company_id', '=', company_id),
            ('list_id.date', 'in', open_dates),
            ('completed_at', '=', False),
            ('deadline_datetime', '!=', False),
            ('deadline_datetime', '<=', grace_cutoff),
            '|',
            ('overdue_alerted_at', '=', False),
            ('overdue_alerted_at', '<=', repeat_cutoff),
        ])
        if not lines:
            return []

        # Everything actually outstanding right now, ignoring who has been told
        # about what. `lines` decides WHETHER to send; this decides what the
        # message may claim. Without the split, a repeat alert reports only the
        # newly-eligible tasks and silently contradicts the earlier one.
        outstanding = self.sudo().search([
            ('list_id.company_id', '=', company_id),
            ('list_id.date', 'in', open_dates),
            ('completed_at', '=', False),
            ('deadline_datetime', '!=', False),
            ('deadline_datetime', '<=', grace_cutoff),
        ])
        outstanding_by_dept = {}
        for line in outstanding:
            outstanding_by_dept.setdefault(line.list_id.department_id.id, []).append(line.name)

        by_dept = {}
        for line in lines:
            dept = line.list_id.department_id
            names = outstanding_by_dept.get(dept.id) or [line.name]
            by_dept.setdefault(dept.id, {
                'department_id': dept.id,
                'department_name': dept.name or 'Department',
                'names': names,
            })

        # Stamp AFTER grouping but BEFORE returning: the caller gets one chance
        # to send these, and a failure to deliver does not re-queue them (a
        # push that silently failed is better than the same push four times).
        lines.write({'overdue_alerted_at': now})
        return list(by_dept.values())

    @api.model
    def portal_accountability(self, company_id, date_from, date_to,
                              department_id=None, allowed_company_ids=None):
        """Who completed what, over a date range. READ ONLY.

        Reports on what people DID, never on what was missed. A task nobody did
        cannot be pinned on anyone: tasks belong to a department and whoever is
        on shift picks them up, so "Marco missed 3" is a sentence this data
        cannot honestly support. "Marco completed 12, 9 on time" it can.

        On time is measured only against tasks that HAD a deadline. Counting a
        task with no deadline as on-time would inflate the number with work that
        was never being timed — which is most tasks until an owner sets their
        service times.
        """
        allowed = [int(c) for c in (allowed_company_ids or [])]
        company_id = int(company_id)
        if not allowed or company_id not in allowed:
            return {'people': [], 'totals': {}}

        domain = [
            ('list_id.company_id', '=', company_id),
            ('list_id.date', '>=', date_from),
            ('list_id.date', '<=', date_to),
            ('completed_at', '!=', False),
        ]
        if department_id:
            domain.append(('list_id.department_id', '=', int(department_id)))

        by_person = {}
        for line in self.sudo().search(domain):
            emp = line.completed_by_id
            # Key on the identity actually being reported, not on the employee
            # id alone. completed_by_id is ondelete='set null', so everyone whose
            # employee record was deleted collapsed to key 0 — two departed
            # people and every unattributed completion merged into ONE row
            # labelled with whichever name happened to be seen first.
            key = ('e', emp.id) if emp.id else ('n', line.completed_by_name or '')
            row = by_person.setdefault(key, {
                'employee_id': emp.id or 0,
                # The denormalised name is preserved on the line, so someone who
                # has since left still shows as themselves rather than blank.
                'name': line.completed_by_name or (emp.name if emp else '') or 'Not recorded',
                'done': 0, 'on_time': 0, 'late': 0, 'untimed': 0,
                'flagged': 0, 'late_minutes_total': 0,
            })
            row['done'] += 1
            if line.review_flagged:
                row['flagged'] += 1
            if not line.deadline_datetime:
                row['untimed'] += 1
            elif line.completed_at <= line.deadline_datetime:
                row['on_time'] += 1
            else:
                row['late'] += 1
                delta = line.completed_at - line.deadline_datetime
                row['late_minutes_total'] += int(delta.total_seconds() // 60)

        people = []
        for row in by_person.values():
            row['avg_late_minutes'] = (
                int(round(row['late_minutes_total'] / row['late'])) if row['late'] else 0
            )
            row.pop('late_minutes_total')
            people.append(row)
        people.sort(key=lambda r: (-r['done'], r['name']))

        return {
            'people': people,
            'totals': {
                'done': sum(p['done'] for p in people),
                'on_time': sum(p['on_time'] for p in people),
                'late': sum(p['late'] for p in people),
                'untimed': sum(p['untimed'] for p in people),
                'flagged': sum(p['flagged'] for p in people),
                'people': len(people),
            },
        }

    @api.model
    def portal_accountability_detail(self, company_id, employee_id, date_from, date_to,
                                     allowed_company_ids=None):
        """One person's completed tasks over the range, newest first. READ ONLY.

        Returns {rows, total} — total is the true match count so the screen can
        say when it is showing only the most recent slice.
        """
        allowed = [int(c) for c in (allowed_company_ids or [])]
        company_id = int(company_id)
        if not allowed or company_id not in allowed:
            return {'rows': [], 'total': 0}
        lines = self.sudo().search([
            ('list_id.company_id', '=', company_id),
            ('list_id.date', '>=', date_from),
            ('list_id.date', '<=', date_to),
            ('completed_at', '!=', False),
            ('completed_by_id', '=', int(employee_id)),
        ], order='completed_at desc', limit=DETAIL_LIMIT)
        # The true count, so the screen can admit to truncating. A silent cap in
        # a report used to judge people reads as "they did nothing that month".
        total = self.sudo().search_count([
            ('list_id.company_id', '=', company_id),
            ('list_id.date', '>=', date_from),
            ('list_id.date', '<=', date_to),
            ('completed_at', '!=', False),
            ('completed_by_id', '=', int(employee_id)),
        ])
        out = []
        for l in lines:
            late_by = 0
            if l.deadline_datetime and l.completed_at > l.deadline_datetime:
                late_by = int((l.completed_at - l.deadline_datetime).total_seconds() // 60)
            out.append({
                'line_id': l.id,
                'name': l.name,
                'date': fields.Date.to_string(l.list_id.date),
                'department_name': l.list_id.department_id.name or '',
                'day_part': l.day_part,
                'deadline': fields.Datetime.to_string(l.deadline_datetime) if l.deadline_datetime else '',
                'deadline_is_implicit': l.deadline_is_implicit,
                'completed_at': fields.Datetime.to_string(l.completed_at),
                'late_by_minutes': late_by,
                'flagged': l.review_flagged,
                'flag_reason': l.review_flag_reason or '',
            })
        return {'rows': out, 'total': total}

    @api.model
    def portal_day_summary(self, company_id, date_str=None):
        """End-of-day counts for one company + date: done/total, the names of
        missed (incomplete) tasks, and how many proof photos were submitted.
        Used by the nightly summary cron; company scoping is the caller's job."""
        company_id = int(company_id)
        date = date_str or fields.Date.to_string(fields.Date.context_today(self))
        lines = self.sudo().search([
            ('list_id.company_id', '=', company_id),
            ('list_id.date', '=', date),
        ])
        done = lines.filtered(lambda l: l.completed_at)
        missed = lines - done
        photos = self._proof_photo_map(done.ids)
        return {
            'company_id': company_id,
            'date': date,
            'total': len(lines),
            'done': len(done),
            'missed_names': missed.sorted('sequence').mapped('name'),
            'photos_to_review': sum(len(v) for v in photos.values()),
        }
