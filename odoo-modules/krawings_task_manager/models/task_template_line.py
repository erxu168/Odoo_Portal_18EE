import mimetypes

from odoo import api, fields, models
from odoo.exceptions import UserError

# Guide size caps — keep aggregate JSON-RPC saves and the nightly snapshot bounded.
GUIDE_MAX_STEPS = 40
GUIDE_MAX_PINS = 20
GUIDE_MAX_EXPLANATION = 2000
GUIDE_MAX_NOTE = 500
GUIDE_MAX_IMAGE_B64 = 12 * 1024 * 1024   # ~9 MB decoded
GUIDE_MAX_PDF_B64 = 20 * 1024 * 1024     # ~15 MB decoded


def _guess_image_mime(filename):
    return mimetypes.guess_type(filename or '')[0] or 'image/jpeg'


DAY_PART_SELECTION = [
    ('opening', 'Opening'),
    ('mid_day', 'Mid-day'),
    ('closing', 'Closing'),
]

MODULE_LINK_SELECTION = [
    ('none', 'None'),
    ('inventory', 'Inventory'),
    ('purchase', 'Purchase'),
    ('pos', 'Point of Sale'),
    ('manufacturing', 'Manufacturing'),
]

RECURRENCE_TYPE_SELECTION = [
    ('once', 'One-off date'),
    ('daily', 'Daily'),
    ('weekly', 'Weekly'),
    ('monthly', 'Monthly'),
    ('yearly', 'Yearly'),
]

RECURRENCE_END_TYPE_SELECTION = [
    ('never', 'Never'),
    ('on_date', 'On a date'),
    ('after_count', 'After N occurrences'),
]

RECURRENCE_MONTHLY_MODE_SELECTION = [
    ('day_of_month', 'On a day of the month'),
    ('weekday_of_month', 'On the Nth weekday of the month'),
]


class KrawingsTaskTemplateLine(models.Model):
    _name = 'krawings.task.template.line'
    _description = 'Department Task Template Line'
    _order = 'day_part, sequence, id'

    template_id = fields.Many2one(
        'krawings.task.template', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    day_part = fields.Selection(DAY_PART_SELECTION, required=True, default='opening')
    deadline_time = fields.Float(
        help='Time of day this task must be done by (24h, e.g. 10.5 = 10:30). Leave empty for no deadline.',
    )
    photo_required = fields.Boolean()
    photo_instructions = fields.Char(
        help='Hint shown to staff above the photo upload button when photo_required is set.',
    )
    module_link_type = fields.Selection(MODULE_LINK_SELECTION, default='none')
    subtask_ids = fields.One2many(
        'krawings.task.template.subtask', 'line_id', copy=True,
    )

    # ── Setup guide (mise en place) ──────────────────────────────────────
    # When set, this task is a visual station-setup guide: one or more
    # reference photos with numbered pins (its subtasks). Photos live on
    # krawings.task.setup.photo (kept out of normal search_read; the portal
    # serves bytes via a dedicated route). The single setup_photo Binary is
    # LEGACY (pre-multi-photo) — migrated into a photo row on upgrade.
    is_setup_guide = fields.Boolean(
        help='Turn this task into a visual setup guide (reference photos + numbered pins).',
    )
    setup_photo = fields.Binary(attachment=True)         # legacy, no longer written
    setup_photo_filename = fields.Char()                 # legacy, no longer written
    setup_photo_ids = fields.One2many(
        'krawings.task.setup.photo', 'template_line_id',
    )

    # ── Guided tutorial (optional per-task how-to) ───────────────────────
    # An ordered sequence of steps (photo / youtube / tip / pdf + explanation;
    # photo steps may carry note-pins). PURELY INSTRUCTIONAL — never completes
    # the task; staff still tick it themselves. Managers/admins edit here; a
    # PUBLISHED guide is snapshotted onto each daily line at spawn. This
    # supersedes the setup-guide fields above (migrated in 18.0.7.0.0).
    guide_step_ids = fields.One2many('krawings.task.guide.step', 'template_line_id')
    guide_published = fields.Boolean(
        default=False,
        help="When on, staff see this task's guide. Off = draft (managers only).",
    )
    guide_revision = fields.Integer(
        default=0,
        help='Bumped on every guide save; optimistic-concurrency token for the editor.',
    )
    has_guide = fields.Boolean(compute='_compute_guide', store=True,
                               help='A PUBLISHED guide with at least one step exists.')
    guide_step_count = fields.Integer(compute='_compute_guide', store=True)

    @api.depends('guide_step_ids', 'guide_published')
    def _compute_guide(self):
        for rec in self:
            rec.guide_step_count = len(rec.guide_step_ids)
            # has_guide reflects staff visibility (published + non-empty). The
            # editor uses guide_step_count to know a draft has content.
            rec.has_guide = bool(rec.guide_published and rec.guide_step_ids)

    # ── Guided-tutorial editor RPC (manager/admin; company checked in the route) ──
    @api.model
    def portal_read_guide(self, template_line_id):
        """Return a template line's full guide for the editor. Media bytes are
        NOT inlined — the editor fetches them via the step-media route."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            return False
        steps = []
        for s in line.guide_step_ids.sorted('sequence'):
            steps.append({
                'id': s.id,
                'media_type': s.media_type,
                'explanation': s.explanation or '',
                'has_image': bool(s.image),
                'image_filename': s.image_filename or '',
                'has_pdf': bool(s.pdf_file),
                'pdf_filename': s.pdf_filename or '',
                'youtube_url': s.youtube_url or '',
                'pins': [
                    {'id': p.id, 'pin_x': p.pin_x, 'pin_y': p.pin_y, 'note': p.note or ''}
                    for p in s.pin_ids.sorted('sequence')
                ],
            })
        return {'revision': line.guide_revision, 'published': line.guide_published, 'steps': steps}

    @api.model
    def portal_save_guide(self, template_line_id, revision, published, steps):
        """Atomically replace a template line's whole ordered guide.

        Row-locks the line and compares `revision` (optimistic concurrency): a
        stale editor gets {conflict:True} (mapped to 409) instead of clobbering
        another manager. Array order is authoritative → normalized sequences.
        A step may `keep` its existing photo/pdf (no base64 re-sent); the prior
        bytes are carried over server-side. Everything is validated by the step/
        pin model constraints. Returns {ok, revision}."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            raise UserError('Task not found.')
        steps = steps or []
        if len(steps) > GUIDE_MAX_STEPS:
            raise UserError('A guide can have at most %s steps.' % GUIDE_MAX_STEPS)

        self.env.flush_all()
        self.env.cr.execute(
            'SELECT guide_revision FROM krawings_task_template_line WHERE id = %s FOR UPDATE',
            (line.id,),
        )
        row = self.env.cr.fetchone()
        current = (row[0] if row else 0) or 0
        if int(revision) != int(current):
            return {'conflict': True, 'revision': current}

        # Snapshot existing media so a `keep` step needn't re-upload its bytes.
        prior = {
            s.id: {
                'image': s.image, 'image_filename': s.image_filename,
                'pdf_file': s.pdf_file, 'pdf_filename': s.pdf_filename,
            }
            for s in line.guide_step_ids
        }
        line.guide_step_ids.unlink()  # cascade pins; clean sequences on rebuild

        Step = self.env['krawings.task.guide.step'].sudo()
        Pin = self.env['krawings.task.guide.pin'].sudo()
        seq = 10
        for st in steps:
            mt = st.get('media_type')
            explanation = (st.get('explanation') or '').strip()
            if len(explanation) > GUIDE_MAX_EXPLANATION:
                raise UserError('An explanation is too long (max %s characters).' % GUIDE_MAX_EXPLANATION)
            prev = prior.get(int(st.get('id') or 0), {})
            vals = {
                'template_line_id': line.id,
                'sequence': seq,
                'media_type': mt,
                'explanation': explanation,
                'image': False, 'image_filename': False,
                'pdf_file': False, 'pdf_filename': False,
                'youtube_url': False,
            }
            if mt == 'photo':
                if st.get('image_base64'):
                    b64 = st['image_base64']
                    if len(b64) > GUIDE_MAX_IMAGE_B64:
                        raise UserError('A photo is too large (max ~9 MB).')
                    vals['image'] = b64
                    vals['image_filename'] = st.get('image_filename') or 'photo.jpg'
                else:
                    vals['image'] = prev.get('image')
                    vals['image_filename'] = prev.get('image_filename')
            elif mt == 'pdf':
                if st.get('pdf_base64'):
                    b64 = st['pdf_base64']
                    if len(b64) > GUIDE_MAX_PDF_B64:
                        raise UserError('A PDF is too large (max ~15 MB).')
                    vals['pdf_file'] = b64
                    vals['pdf_filename'] = st.get('pdf_filename') or 'document.pdf'
                else:
                    vals['pdf_file'] = prev.get('pdf_file')
                    vals['pdf_filename'] = prev.get('pdf_filename')
            elif mt == 'youtube':
                vals['youtube_url'] = (st.get('youtube_url') or '').strip()
            # 'tip' keeps everything empty.
            step = Step.create(vals)   # model constraints validate media + explanation

            if mt == 'photo':
                pins = st.get('pins') or []
                if len(pins) > GUIDE_MAX_PINS:
                    raise UserError('A photo can have at most %s note-pins.' % GUIDE_MAX_PINS)
                pseq = 10
                for p in pins:
                    note = (p.get('note') or '').strip()
                    if len(note) > GUIDE_MAX_NOTE:
                        raise UserError('A pin note is too long (max %s characters).' % GUIDE_MAX_NOTE)
                    Pin.create({
                        'step_id': step.id,
                        'sequence': pseq,
                        'pin_x': float(p.get('pin_x') or 0.0),
                        'pin_y': float(p.get('pin_y') or 0.0),
                        'note': note,
                    })
                    pseq += 10
            seq += 10

        new_rev = current + 1
        line.write({'guide_revision': new_rev, 'guide_published': bool(published)})
        return {'ok': True, 'revision': new_rev}

    @api.model
    def portal_delete_guide(self, template_line_id):
        """Remove a template line's whole guide."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            raise UserError('Task not found.')
        line.guide_step_ids.unlink()
        line.write({'guide_published': False, 'guide_revision': (line.guide_revision or 0) + 1})
        return {'ok': True, 'revision': line.guide_revision}

    # ── Recurrence rule (per task) ───────────────────────────────────────
    # Keys here are read by recurrence.applies_on() via rule_from_record().
    recurrence_type = fields.Selection(
        RECURRENCE_TYPE_SELECTION, required=True, default='daily',
    )
    recurrence_interval = fields.Integer(
        default=1, help='Repeat every N units (days/weeks/months/years).',
    )
    recurrence_start_date = fields.Date(
        required=True, default=fields.Date.context_today,
        help='First day the rule is effective. Anchors weekly/monthly/yearly counters.',
    )
    recurrence_end_type = fields.Selection(
        RECURRENCE_END_TYPE_SELECTION, required=True, default='never',
    )
    recurrence_end_date = fields.Date()
    recurrence_count = fields.Integer(help='Number of occurrences when end_type=after_count.')

    recurrence_one_off_date = fields.Date(help='Used when type=once.')

    # weekly: comma-separated weekday indices, Mon=0..Sun=6
    recurrence_weekdays = fields.Char(default='0,1,2,3,4,5,6')

    # monthly + yearly: which day of the month to fire on
    recurrence_monthly_mode = fields.Selection(
        RECURRENCE_MONTHLY_MODE_SELECTION, default='day_of_month',
    )
    recurrence_day_of_month = fields.Integer(
        default=1, help='1..31, or -1 for "last day of the month".',
    )
    recurrence_weekday_pos = fields.Integer(
        default=1, help='1..4 = first..fourth occurrence, -1 = last occurrence.',
    )
    recurrence_weekday = fields.Integer(
        default=0, help='Mon=0..Sun=6 (used when monthly_mode=weekday_of_month).',
    )
    # yearly only
    recurrence_month = fields.Integer(default=1, help='1..12 (yearly only).')

    exception_ids = fields.One2many(
        'krawings.task.template.line.exception', 'line_id',
        copy=True, help='Specific dates the rule should NOT fire even if it otherwise would.',
    )

    @api.model
    def list_attachments(self, line_ids):
        """Return [{id, line_id, name, mimetype, file_size}] for the given lines."""
        if not line_ids:
            return []
        recs = self.env['ir.attachment'].sudo().search_read(
            # res_field=False excludes field-backed binaries (the setup_photo).
            [('res_model', '=', self._name), ('res_id', 'in', line_ids),
             ('res_field', '=', False)],
            ['id', 'res_id', 'name', 'mimetype', 'file_size'],
            order='id asc',
        )
        return [
            {
                'id': r['id'],
                'line_id': r['res_id'],
                'name': r['name'],
                'mimetype': r.get('mimetype') or '',
                'file_size': r.get('file_size') or 0,
            }
            for r in recs
        ]

    def add_attachment(self, name, data_base64, mimetype=False):
        """Attach a file to this template line. Returns the new attachment id."""
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

    # ── Setup-guide reference photos (multi-photo) ───────────────────────

    def add_setup_photo(self, data_base64, filename, seq=None):
        """Add a reference photo. Pass `seq` ONLY to replace an existing slot's
        bytes; omit it to APPEND (the server allocates the next sequence). Always
        returns the photo's actual sequence — the client must use the returned
        value (it may differ from a guessed one under concurrent edits) and remap
        its pins accordingly.

        Append allocation is serialized on the parent-line row so two editors of
        the same guide can't grab the same next sequence and overwrite one another."""
        self.ensure_one()
        Photo = self.env['krawings.task.setup.photo'].sudo()
        if seq is not None:
            seq = int(seq)
            existing = Photo.search([
                ('template_line_id', '=', self.id), ('sequence', '=', seq),
            ], limit=1)
            if existing:
                # Pins are NOT touched here: the editor saves the pin set (with
                # any stale pins already removed) BEFORE uploading photos, so a
                # server-side unlink would destroy just-saved pins.
                existing.write({'image': data_base64, 'filename': filename or False})
                return seq
            # seq given but the slot is free → fall through and create it there.
        else:
            # Flush so a prior create in THIS transaction is visible to MAX, then
            # lock the line row so concurrent appends serialize.
            self.env.flush_all()
            self.env.cr.execute(
                'SELECT id FROM krawings_task_template_line WHERE id = %s FOR UPDATE',
                (self.id,))
            self.env.cr.execute(
                'SELECT COALESCE(MAX(sequence), -1) + 1 '
                'FROM krawings_task_setup_photo WHERE template_line_id = %s',
                (self.id,))
            seq = self.env.cr.fetchone()[0]
        Photo.create({
            'template_line_id': self.id,
            'sequence': seq,
            'image': data_base64,
            'filename': filename or False,
        })
        return seq

    def remove_setup_photo(self, seq):
        """Delete one reference photo and every pin placed on it."""
        self.ensure_one()
        seq = int(seq)
        self.setup_photo_ids.filtered(lambda p: p.sequence == seq).unlink()
        self.subtask_ids.filtered(lambda s: s.pin_photo_seq == seq).unlink()
        return True

    def set_setup_photo(self, data_base64, filename, clear_pins=False):
        """LEGACY single-photo entry (kept for API compat): writes photo slot 0;
        falsy payload clears ALL photos. `clear_pins` drops every pin."""
        self.ensure_one()
        if data_base64:
            self.add_setup_photo(data_base64, filename, seq=0)
        else:
            self.setup_photo_ids.unlink()
            self.write({'setup_photo': False, 'setup_photo_filename': False})
        if clear_pins and self.subtask_ids:
            self.subtask_ids.unlink()
        return True

    @api.model
    def get_setup_photo(self, line_id, allowed_company_ids=None):
        """LEGACY single-photo read: serves the line's first photo (company-scoped).
        Falls back to the pre-multi-photo Binary for un-migrated rows."""
        rec = self.sudo().browse(int(line_id))
        if not rec.exists():
            return False
        first = rec.setup_photo_ids.sorted('sequence')[:1]
        if first:
            return self.env['krawings.task.setup.photo'].get_photo(
                'template', rec.id, first.sequence, allowed_company_ids)
        if not rec.setup_photo:
            return False
        if allowed_company_ids:
            company_id = rec.template_id.company_id.id
            if not company_id or company_id not in [int(c) for c in allowed_company_ids]:
                return False
        raw = rec.setup_photo
        return {
            'filename': rec.setup_photo_filename or 'setup.jpg',
            'mimetype': _guess_image_mime(rec.setup_photo_filename),
            'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
        }


class KrawingsTaskTemplateLineException(models.Model):
    _name = 'krawings.task.template.line.exception'
    _description = 'Recurrence exception (skip this date)'
    _order = 'date'

    line_id = fields.Many2one(
        'krawings.task.template.line', required=True, ondelete='cascade', index=True,
    )
    date = fields.Date(required=True)
    note = fields.Char(help='Optional reason — purely informational.')

    _sql_constraints = [
        ('uniq_line_date', 'unique(line_id, date)',
         'A line cannot have the same exception date twice.'),
    ]
