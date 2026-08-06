from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .task_guide_step import normalize_drawings
from .task_template_line import _guess_image_mime


class KrawingsTaskTemplateSubtask(models.Model):
    _name = 'krawings.task.template.subtask'
    _description = 'Department Task Template Subtask'
    _order = 'sequence, id'

    line_id = fields.Many2one(
        'krawings.task.template.line', required=True, ondelete='cascade', index=True,
    )
    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)

    # ── Setup-guide pin (only meaningful when the parent line is_setup_guide) ──
    # Stored as fractions of the reference image so they survive different
    # screen sizes; the portal converts to %. On a setup-guide line EVERY
    # subtask is a pin (v1 invariant).
    pin_photo_seq = fields.Integer(
        default=0,
        help='Sequence of the setup photo this pin sits on (multi-photo guides).',
    )
    pin_x = fields.Float(help='0.0–1.0, fraction across the reference image.')
    pin_y = fields.Float(help='0.0–1.0, fraction down the reference image.')
    item_id = fields.Many2one(
        'krawings.task.item', ondelete='set null', index=True,
        help='Catalog item this pin labels. name is denormalised for history.',
    )


    # ── Reference photo with drawn marks (annotated-photo pattern) ───────────
    # A subtask is one short instruction, so the photo POINTS at something —
    # "circle the tray", "arrow to the dial". Drawings only, no numbered pins: a
    # subtask needing three numbered notes is a guide, and guides already exist.
    # Coordinates inside `drawings` are fractions 0..1 of the displayed image,
    # so a mark lands identically on a phone and a kitchen tablet.
    image = fields.Binary(attachment=True)
    image_filename = fields.Char()
    drawings = fields.Text(
        help='JSON array of drawn shapes over the photo; coordinates are fractions 0..1.',
    )

    @api.constrains('drawings', 'image')
    def _check_drawings(self):
        for rec in self:
            if rec.drawings and not rec.image:
                raise ValidationError('Only a subtask with a photo can carry drawings.')
            if rec.drawings:
                # Same validator the guide steps use — one definition of what a
                # drawing may contain, for every annotated photo in the module.
                normalize_drawings(rec.drawings)

    @api.constrains('pin_x', 'pin_y')
    def _check_pin_bounds(self):
        for rec in self:
            for val in (rec.pin_x, rec.pin_y):
                if val < 0.0 or val > 1.0:
                    raise ValidationError('Pin coordinates must be between 0 and 1.')

    @api.model
    def portal_photo(self, subtask_id, allowed_company_ids=None, parent_line_id=None):
        """This subtask's reference photo bytes, company-scoped, fail-CLOSED.

        `parent_line_id` must match the subtask's own line — without it, a
        same-company subtask id could be substituted to read a photo from a
        different task. Mirrors krawings.task.guide.step.get_media.
        """
        rec = self.sudo().browse(int(subtask_id))
        if not rec.exists() or not rec.image:
            return False
        if parent_line_id and rec.line_id.id != int(parent_line_id):
            return False
        company = rec.line_id.template_id.department_id.company_id
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or not company.id or company.id not in allowed:
            return False
        return {
            'filename': rec.image_filename or 'photo.jpg',
            'mimetype': _guess_image_mime(rec.image_filename),
            'data_base64': rec.image.decode() if isinstance(rec.image, bytes) else rec.image,
        }
