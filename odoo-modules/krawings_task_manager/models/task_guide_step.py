from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .task_template_line import _guess_image_mime

MEDIA_TYPES = [
    ('photo', 'Photo'),
    ('youtube', 'YouTube video'),
    ('tip', 'Tip / warning'),
    ('pdf', 'PDF document'),
]


class KrawingsTaskGuideStep(models.Model):
    """One step of a task's optional guided tutorial. A guide is just the
    ordered collection of these steps — there is no separate header model.

    Dual parent, mirroring krawings.task.setup.photo: a step belongs to a
    TEMPLATE line (the editable source, edited by managers/admins) OR to a
    daily LIST line (an immutable snapshot taken at spawn time). Exactly one
    parent is set.

    A guide is PURELY INSTRUCTIONAL: viewing steps or tapping pins never marks
    the task done. Staff always complete the task through the normal control."""
    _name = 'krawings.task.guide.step'
    _description = 'Guided Tutorial Step'
    _order = 'sequence, id'

    template_line_id = fields.Many2one(
        'krawings.task.template.line', ondelete='cascade', index=True,
    )
    list_line_id = fields.Many2one(
        'krawings.task.list.line', ondelete='cascade', index=True,
    )
    # Traceability from a daily snapshot back to the template step it came from.
    source_template_step_id = fields.Many2one(
        'krawings.task.guide.step', ondelete='set null',
    )

    sequence = fields.Integer(required=True, default=0)
    media_type = fields.Selection(MEDIA_TYPES, required=True, default='photo')
    explanation = fields.Text(required=True)

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
         'CHECK((template_line_id IS NOT NULL) != (list_line_id IS NOT NULL))',
         'A guide step belongs to exactly one template line or one list line.'),
        ('uniq_template_seq', 'unique(template_line_id, sequence)',
         'Step sequence numbers must be unique per template line.'),
        ('uniq_list_seq', 'unique(list_line_id, sequence)',
         'Step sequence numbers must be unique per list line.'),
    ]

    @api.constrains('media_type', 'image', 'pdf_file', 'youtube_url', 'explanation', 'pin_ids')
    def _check_media(self):
        for s in self:
            if not (s.explanation and s.explanation.strip()):
                raise ValidationError('Every guide step needs an explanation.')
            mt = s.media_type
            if mt == 'photo' and not s.image:
                raise ValidationError('A photo step needs a photo.')
            if mt == 'pdf' and not s.pdf_file:
                raise ValidationError('A PDF step needs a PDF file.')
            if mt == 'youtube' and not (s.youtube_url and s.youtube_url.strip()):
                raise ValidationError('A YouTube step needs a video link.')
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
    def snapshot_to_list_line(self, template_line, list_line):
        """Deep-copy a template line's published guide (steps + pins) onto a
        freshly spawned daily list line, so staff always see what was current
        that day even if the template is edited later. Called from the spawn
        path. Odoo's filestore checksum dedup means identical image/pdf bytes
        are not physically duplicated."""
        Pin = self.env['krawings.task.guide.pin'].sudo()
        for step in template_line.guide_step_ids.sorted('sequence'):
            new_step = self.sudo().create({
                'list_line_id': list_line.id,
                'source_template_step_id': step.id,
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
        """Serve one step's photo or PDF bytes for the portal. `kind` is
        'template' or 'list'; company-scoped through the parent line and fails
        CLOSED for a company-less parent. Returns {filename, mimetype,
        data_base64} or False."""
        rec = self.sudo().browse(int(step_id))
        if not rec.exists():
            return False
        # A step must be parented to the kind of line the caller claims.
        if kind == 'template' and not rec.template_line_id:
            return False
        if kind == 'list' and not rec.list_line_id:
            return False
        company = (rec.template_line_id.template_id.company_id
                   if rec.template_line_id else rec.list_line_id.list_id.company_id)
        if allowed_company_ids:
            if not company.id or company.id not in [int(c) for c in allowed_company_ids]:
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
