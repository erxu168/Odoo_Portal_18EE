import mimetypes
import re

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

# Guide size caps — keep aggregate JSON-RPC saves and the nightly snapshot bounded.
GUIDE_MAX_STEPS = 40
GUIDE_MAX_PINS = 20
GUIDE_MAX_EXPLANATION = 6000
GUIDE_MAX_NOTE = 500
# The manager's standing note on a task. Bounded because it is deep-copied onto
# every daily line at spawn, so an unbounded blob would compound day after day.
MAX_MANAGER_NOTE = 3000
# Hard ceiling on the stored MARKUP. The user-facing limits count words, which
# an enormous href or a million empty tags slip straight past — and every one of
# these fields is deep-copied onto a new daily task every single day.
MAX_RICH_TEXT_BYTES = 24000
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


# ── Formatted text (guide explanations, the note for staff) ──────────────────
# Managers author these; STAFF render them. Odoo's html_sanitize is the real
# security boundary here — it is lxml-backed and strips scripts, event handlers,
# styles and dangerous protocols. The portal repeats a stricter ALLOWLIST at
# render time (src/lib/rich-text.ts) as a second, independent guard.
RICH_TEXT_TAGS = (
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'h2', 'h3', 'blockquote', 'code', 'a',
)
# `[^>]*`, not `(?:\s[^>]*)?`: HTML ends a tag name at "/" as well as at
# whitespace, so demanding a space missed `<img/src=x onerror=…>` entirely — and
# re.sub leaves an unmatched tag verbatim, i.e. the allowlist failed OPEN.
_TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>')
# Mirrors isRichText() in src/lib/rich-text.ts — the two MUST agree, or a value
# one side treats as plain text the other will parse as markup.
_RICH_RE = re.compile(
    r'<(p|br|ul|ol|li|h2|h3|strong|b|em|i|u|s|a|blockquote|code)\b[^>]*>', re.I)


def is_rich_text(value):
    """Formatted text, or legacy plain text written before the editor existed?"""
    return bool(value) and bool(_RICH_RE.search(str(value)))


def sanitize_rich_text(value):
    """Store-safe HTML for a manager-authored field.

    Two passes. html_sanitize does the security work; the allowlist pass then
    drops anything the PORTAL will not render anyway — notably <img>, which
    html_sanitize keeps (harmlessly, once its onerror is stripped). Without that
    pass a pasted image would be stored, count against the length cap, and then
    silently vanish for staff — the author would never learn their paste did
    nothing.
    """
    if not value:
        return ''
    # Leave LEGACY PLAIN TEXT exactly as it is. html_sanitize wraps a bare
    # string in <p>…</p>, and HTML collapses the newlines inside it — so simply
    # sanitising on every write would silently flatten every multi-line note
    # written before the editor existed. The portal renders a non-HTML value as
    # plain text (ui/RichText), so it never reaches an HTML parser anyway.
    if not is_rich_text(value):
        return str(value)
    from odoo.tools.mail import html_sanitize
    cleaned = html_sanitize(
        value,
        sanitize_tags=True,
        sanitize_attributes=True,
        sanitize_style=True,
        strip_style=True,
        strip_classes=True,
    )
    cleaned = str(cleaned or '')

    # Anchors cannot nest, so one counter drops the </a> of an opener we
    # rejected — otherwise a blocked javascript: link left a stray closing tag.
    dropped = [0]

    def _keep(m):
        tag = m.group(2).lower()
        if tag not in RICH_TEXT_TAGS:
            return ''
        if tag != 'a':
            return '<%s%s>' % (m.group(1), tag)
        # html_sanitize has already neutralised the href; keep only that one
        # attribute so the stored markup matches what the portal will render.
        if m.group(1):
            if dropped[0] > 0:
                dropped[0] -= 1
                return ''
            return '</a>'
        href = re.search(r'\bhref\s*=\s*"([^"]*)"', m.group(3) or '')
        url = (href.group(1) if href else '').strip()
        if not re.match(r'\A(https?://|mailto:)', url, re.I):
            dropped[0] += 1
            return ''
        return '<a href="%s">' % url.replace('"', '&quot;')

    return _TAG_RE.sub(_keep, cleaned).strip()


def rich_text_to_plain(value):
    """The words only — used to test "is this actually empty?" and to measure
    real length. `<p></p>` is an empty editor, not an explanation."""
    if not value:
        return ''
    text = re.sub(r'<[^>]+>', ' ', str(value))
    for entity, char in (('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'),
                         ('&gt;', '>'), ('&quot;', '"'), ('&#39;', "'")):
        text = text.replace(entity, char)
    return re.sub(r'\s+', ' ', text).strip()


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
    # Standing guidance the MANAGER writes on the task definition, shown to
    # whoever does it, every day it runs. Distinct from krawings.task.list.line
    # `note`, which is what STAFF write about one particular day — hence the
    # explicit `manager_` prefix rather than a second bare `note`.
    manager_note = fields.Text(
        help="Note from the manager, shown to staff when they open this task. "
             "Standing guidance (e.g. 'Check the walk-in AND the dry store'), "
             "not a remark about one day.",
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

    # ── Guided tutorial link (optional per-task how-to) ──────────────────
    # A task LINKS one reusable library guide (krawings.task.guide); many tasks
    # may share one guide, and editing the guide updates them all. PURELY
    # INSTRUCTIONAL — never completes the task; staff still tick it themselves.
    # A PUBLISHED linked guide is snapshotted onto each daily line at spawn.
    # (Before 18.0.8.0.0 the guide's steps lived directly on this line; the
    # migration moved them into a standalone guide and set guide_id.)
    guide_id = fields.Many2one(
        'krawings.task.guide', ondelete='restrict', index=True,
        help='The reusable guide this task links (built in the guide Library).',
    )
    # Read-through mirrors of the linked guide, so the daily hydration and task
    # list can filter/show the guide without dereferencing guide_id everywhere.
    # Explicit string= avoids a duplicate "Name" label clash with the line's name.
    guide_name = fields.Char(related='guide_id.name', string='Guide name', readonly=True)
    guide_published = fields.Boolean(
        related='guide_id.published', store=True, readonly=True,
    )
    guide_revision = fields.Integer(
        related='guide_id.revision', store=True, readonly=True,
    )
    guide_step_count = fields.Integer(
        related='guide_id.step_count', store=True, readonly=True,
    )
    has_guide = fields.Boolean(
        compute='_compute_has_guide', store=True,
        help='A PUBLISHED linked guide with at least one step exists.',
    )

    @api.depends('guide_id.published', 'guide_id.step_count')
    def _compute_has_guide(self):
        for rec in self:
            rec.has_guide = bool(
                rec.guide_id and rec.guide_id.published and rec.guide_id.step_count
            )

    @api.constrains('guide_id', 'template_id')
    def _check_guide_company(self):
        """A task may only link a guide from its own company — re-checked when the
        task moves to another template/company, not just when the link changes."""
        for line in self:
            if line.guide_id and line.template_id.company_id != line.guide_id.company_id:
                raise ValidationError('A task can only link a guide from the same company.')

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
        for line in self:
            if line.manager_note and len(line.manager_note) > MAX_RICH_TEXT_BYTES:
                raise ValidationError(
                    'That note is too large. Remove some formatting or a very long link.'
                )
            if line.manager_note and len(rich_text_to_plain(line.manager_note)) > MAX_MANAGER_NOTE:
                raise ValidationError(
                    'A note for staff can be at most %d characters.' % MAX_MANAGER_NOTE
                )

    # ── Guided-tutorial editor RPC — BACKWARD-COMPAT SHIMS ────────────────
    # The library-era editor talks to krawings.task.guide directly. These shims
    # keep the PREVIOUS portal build working across the deploy window: they act
    # on this task's LINKED guide, auto-creating+attaching one on first save so
    # the old "edit the guide on the task" flow is unchanged. Removed in the
    # 18.0.9.0.0 contract migration once the portal is fully cut over.
    @api.model
    def portal_read_guide(self, template_line_id):
        line = self.sudo().browse(int(template_line_id))
        if not line.exists() or not line.guide_id:
            return {'revision': 0, 'published': False, 'steps': []}
        data = self.env['krawings.task.guide'].sudo().portal_read_guide(line.guide_id.id)
        return data or {'revision': 0, 'published': False, 'steps': []}

    @api.model
    def portal_save_guide(self, template_line_id, revision, published, steps):
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            raise UserError('Task not found.')
        Guide = self.env['krawings.task.guide'].sudo()
        guide = line.guide_id
        if not guide:
            # Serialize concurrent first-saves: lock the line so two old-portal
            # saves can't each auto-create a separate guide and orphan one of them.
            self.env.flush_all()
            self.env.cr.execute(
                'SELECT guide_id FROM krawings_task_template_line WHERE id = %s FOR UPDATE',
                (line.id,),
            )
            row = self.env.cr.fetchone()
            existing = row[0] if row else None
            if existing:
                guide = Guide.browse(existing)
            else:
                guide = Guide.create({
                    'name': line.name or 'Guide',
                    'company_id': line.template_id.company_id.id,
                    'published': False,
                    'revision': 0,
                })
                line.guide_id = guide.id
                self.env.flush_all()   # release the row lock holding the link
        return Guide.portal_save_guide(guide.id, revision, published, steps)

    @api.model
    def portal_delete_guide(self, template_line_id):
        """Detach this task's guide (the shared library guide is kept)."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            raise UserError('Task not found.')
        line.guide_id = False
        return {'ok': True, 'revision': 0}

    # ── Library-era attach / detach (many tasks → one guide) ──────────────
    @api.model
    def portal_guide_link(self, template_line_id):
        """Link metadata for the task's guide picker: which library guide (if
        any) this task points at, and its headline state."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            return False
        g = line.guide_id
        return {
            'template_line_id': line.id,
            'guide_id': g.id if g else False,
            'name': g.name if g else '',
            'published': g.published if g else False,
            'revision': g.revision if g else 0,
            'step_count': g.step_count if g else 0,
        }

    @api.model
    def portal_attach_guide(self, template_line_id, guide_id):
        """Attach (guide_id truthy) or detach (falsy) a library guide to this
        task. Only links — never edits guide content or bumps its revision, so a
        future spawn is the only thing affected. Company match is enforced here
        AND by _check_guide_company. Returns the fresh link metadata."""
        line = self.sudo().browse(int(template_line_id))
        if not line.exists():
            raise UserError('Task not found.')
        if guide_id:
            guide = self.env['krawings.task.guide'].sudo().browse(int(guide_id))
            if not guide.exists():
                raise UserError('Guide not found.')
            if guide.company_id != line.template_id.company_id:
                raise UserError('That guide belongs to a different company.')
            line.guide_id = guide.id
        else:
            line.guide_id = False
        return self.portal_guide_link(line.id)

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
