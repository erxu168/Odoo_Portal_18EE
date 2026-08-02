import re
from urllib.parse import urlparse, parse_qs

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .task_template_line import _guess_image_mime

MEDIA_TYPES = [
    ('photo', 'Photo'),
    ('youtube', 'YouTube video'),
    ('tip', 'Tip / warning'),
    ('pdf', 'PDF document'),
]

_YT_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')


def youtube_video_id(url):
    """Return the 11-char video id for an accepted YouTube URL, else None.
    Server-side gate mirroring the portal's youtube-url.ts: https only, known
    hosts/paths, strict id shape. Defends against direct Odoo writes."""
    try:
        u = urlparse((url or '').strip())
    except (ValueError, TypeError):
        return None
    if u.scheme != 'https':
        return None
    host = (u.hostname or '').lower()
    vid = None
    if host in ('www.youtube.com', 'youtube.com', 'm.youtube.com'):
        if u.path == '/watch':
            vid = (parse_qs(u.query).get('v') or [None])[0]
        elif u.path.startswith('/embed/'):
            vid = u.path.split('/embed/', 1)[1].split('/')[0]
        elif u.path.startswith('/shorts/'):
            vid = u.path.split('/shorts/', 1)[1].split('/')[0]
    elif host == 'youtu.be':
        vid = u.path.lstrip('/').split('/')[0]
    return vid if vid and _YT_ID.match(vid) else None


class KrawingsTaskGuideStep(models.Model):
    """One step of a guided tutorial. A guide is just the ordered collection of
    these steps — there is no separate content model beyond krawings.task.guide.

    A step belongs to exactly ONE parent:
      - guide_id       — the reusable library guide (the editable source).
      - list_line_id   — a daily task's immutable snapshot, taken at spawn.
      - template_line_id — LEGACY per-task guide (pre-library). Kept nullable
        through the expand window so the registry loads before the 18.0.8.0.0
        migration moves the live step onto its guide; dropped in 18.0.9.0.0.

    A guide is PURELY INSTRUCTIONAL: viewing steps or tapping pins never marks
    the task done. Staff always complete the task through the normal control."""
    _name = 'krawings.task.guide.step'
    _description = 'Guided Tutorial Step'
    _order = 'sequence, id'

    guide_id = fields.Many2one(
        'krawings.task.guide', ondelete='cascade', index=True,
    )
    template_line_id = fields.Many2one(
        'krawings.task.template.line', ondelete='cascade', index=True,
    )  # LEGACY (expand window) — see class docstring.
    list_line_id = fields.Many2one(
        'krawings.task.list.line', ondelete='cascade', index=True,
    )
    # Traceability from a daily snapshot back to the library guide step it came
    # from. source_template_step_id is LEGACY (kept through the expand window,
    # backfilled into source_guide_step_id by the migration, dropped in 18.0.9).
    source_guide_step_id = fields.Many2one(
        'krawings.task.guide.step', ondelete='set null',
    )
    source_template_step_id = fields.Many2one(
        'krawings.task.guide.step', ondelete='set null',
    )

    sequence = fields.Integer(required=True, default=0)
    media_type = fields.Selection(MEDIA_TYPES, required=True, default='photo')
    # Not DB-required: a DRAFT guide may hold half-finished steps (empty
    # explanation / missing media). Completeness is enforced only at PUBLISH
    # time in portal_save_guide, so managers can save work-in-progress.
    explanation = fields.Text()

    # photo steps only (attachment=True → bytes live in ir.attachment, exactly
    # like setup photos; they are NOT proof photos and never show in the task's
    # attachment list)
    image = fields.Binary(attachment=True)
    image_filename = fields.Char()
    # pdf steps only
    pdf_file = fields.Binary(attachment=True)
    pdf_filename = fields.Char()
    # youtube steps only — canonical https://www.youtube.com/watch?v=<id>
    youtube_url = fields.Char()

    pin_ids = fields.One2many('krawings.task.guide.pin', 'step_id')

    _sql_constraints = [
        ('one_parent',
         'CHECK(('
         '(guide_id IS NOT NULL)::int'
         ' + (template_line_id IS NOT NULL)::int'
         ' + (list_line_id IS NOT NULL)::int) = 1)',
         'A guide step belongs to exactly one guide, template line, or list line.'),
        ('uniq_guide_seq', 'unique(guide_id, sequence)',
         'Step sequence numbers must be unique per guide.'),
        ('uniq_template_seq', 'unique(template_line_id, sequence)',
         'Step sequence numbers must be unique per template line.'),
        ('uniq_list_seq', 'unique(list_line_id, sequence)',
         'Step sequence numbers must be unique per list line.'),
    ]

    @api.constrains('media_type', 'image', 'pdf_file', 'youtube_url', 'pin_ids')
    def _check_media(self):
        """STRUCTURAL integrity only — enforced on every step, incl. drafts.
        Completeness (a non-empty explanation and the step's own media) is a
        PUBLISH-time rule and lives in portal_save_guide, so a draft can hold
        half-finished steps."""
        for s in self:
            mt = s.media_type
            # If a YouTube link IS present it must be a real YouTube link
            # (blocks non-YouTube URLs reaching staff / the embed).
            if s.youtube_url and not youtube_video_id(s.youtube_url):
                raise ValidationError('Enter a valid YouTube link (youtube.com/watch, youtu.be, /shorts or /embed).')
            # Forbidden combinations — keep each step type clean.
            if mt != 'photo' and s.pin_ids:
                raise ValidationError('Only photo steps can have note-pins.')
            if mt != 'photo' and s.image:
                raise ValidationError('Only a photo step can carry a photo.')
            if mt != 'pdf' and s.pdf_file:
                raise ValidationError('Only a PDF step can carry a PDF.')
            if mt != 'youtube' and s.youtube_url:
                raise ValidationError('Only a YouTube step can carry a video link.')

    @api.model
    def snapshot_to_list_line(self, guide, list_line):
        """Deep-copy a library guide (steps + pins) onto a freshly spawned daily
        list line, so staff always see what was current that day even if the
        guide is edited later. Odoo's filestore checksum dedup means identical
        image/pdf bytes are not physically duplicated. (The spawn path in
        task_template.py inlines the same copy; this helper mirrors it.)"""
        Pin = self.env['krawings.task.guide.pin'].sudo()
        for step in guide.step_ids.sorted('sequence'):
            new_step = self.sudo().create({
                'list_line_id': list_line.id,
                'source_guide_step_id': step.id,
                'sequence': step.sequence,
                'media_type': step.media_type,
                'explanation': step.explanation,
                'image': step.image,
                'image_filename': step.image_filename,
                'pdf_file': step.pdf_file,
                'pdf_filename': step.pdf_filename,
                'youtube_url': step.youtube_url,
            })
            for pin in step.pin_ids.sorted('sequence'):
                Pin.create({
                    'step_id': new_step.id,
                    'sequence': pin.sequence,
                    'pin_x': pin.pin_x,
                    'pin_y': pin.pin_y,
                    'note': pin.note,
                })

    @api.model
    def get_media(self, kind, step_id, allowed_company_ids=None):
        """Serve one step's photo or PDF bytes for the portal. `kind` is:
          - 'guide'    — a library guide step (company via guide_id).
          - 'list'     — a daily snapshot step (company via list line).
          - 'template' — LEGACY editable-source kind; resolves a step whether it
            still hangs off a template line OR has been moved onto its guide, so
            the previous portal keeps working across the library migration.
        Company-scoped through the parent and fails CLOSED for a company-less
        parent. Returns {filename, mimetype, data_base64} or False."""
        if kind not in ('guide', 'template', 'list'):
            return False
        rec = self.sudo().browse(int(step_id))
        if not rec.exists():
            return False
        # Resolve the parent's company for the kind the caller claims.
        if kind == 'list':
            if not rec.list_line_id:
                return False
            company = rec.list_line_id.list_id.company_id
        elif kind == 'guide':
            if not rec.guide_id:
                return False
            company = rec.guide_id.company_id
        else:  # 'template' — editable source, template line or its guide
            if rec.guide_id:
                company = rec.guide_id.company_id
            elif rec.template_line_id:
                company = rec.template_line_id.template_id.company_id
            else:
                return False
        # Fail CLOSED: require an explicit allowed-company scope, and the
        # parent's company must be inside it. A company-less parent never leaks.
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or not company.id or company.id not in allowed:
            return False
        if rec.media_type == 'photo' and rec.image:
            raw = rec.image
            return {
                'filename': rec.image_filename or f'guide-{rec.id}.jpg',
                'mimetype': _guess_image_mime(rec.image_filename),
                'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
            }
        if rec.media_type == 'pdf' and rec.pdf_file:
            raw = rec.pdf_file
            return {
                'filename': rec.pdf_filename or f'guide-{rec.id}.pdf',
                'mimetype': 'application/pdf',
                'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
            }
        return False
