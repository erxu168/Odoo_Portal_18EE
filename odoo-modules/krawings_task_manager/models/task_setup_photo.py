from odoo import api, fields, models

from .task_template_line import _guess_image_mime


class KrawingsTaskSetupPhoto(models.Model):
    """One reference photo of a setup guide. A guide can carry several photos;
    pins link to a photo through its `sequence` (stable across the nightly
    spawn: daily copies keep the same sequence numbers, so pin_photo_seq needs
    no remapping). Exactly one of template_line_id / list_line_id is set."""
    _name = 'krawings.task.setup.photo'
    _description = 'Setup Guide Reference Photo'
    _order = 'sequence, id'

    template_line_id = fields.Many2one(
        'krawings.task.template.line', ondelete='cascade', index=True,
    )
    list_line_id = fields.Many2one(
        'krawings.task.list.line', ondelete='cascade', index=True,
    )
    sequence = fields.Integer(required=True, default=0)
    image = fields.Binary(attachment=True, required=True)
    filename = fields.Char()

    _sql_constraints = [
        ('one_parent',
         'CHECK((template_line_id IS NOT NULL) != (list_line_id IS NOT NULL))',
         'A setup photo belongs to exactly one template line or one list line.'),
        ('uniq_template_seq', 'unique(template_line_id, sequence)',
         'Photo sequence numbers must be unique per template line.'),
        ('uniq_list_seq', 'unique(list_line_id, sequence)',
         'Photo sequence numbers must be unique per list line.'),
    ]

    @api.model
    def get_photo(self, kind, line_id, seq, allowed_company_ids=None):
        """Serve one photo's bytes for the portal.
        `kind` is 'template' or 'list'; company-scoped through the parent line.
        Returns {filename, mimetype, data_base64} or False."""
        domain = [('sequence', '=', int(seq))]
        if kind == 'template':
            domain.append(('template_line_id', '=', int(line_id)))
        else:
            domain.append(('list_line_id', '=', int(line_id)))
        rec = self.sudo().search(domain, limit=1)
        if not rec or not rec.image:
            return False
        if allowed_company_ids:
            company = (rec.template_line_id.template_id.company_id
                       if kind == 'template' else rec.list_line_id.list_id.company_id)
            # Fail CLOSED: a company-less parent must not leak to a scoped user.
            if not company.id or company.id not in [int(c) for c in allowed_company_ids]:
                return False
        raw = rec.image
        return {
            'filename': rec.filename or f'setup-{rec.sequence}.jpg',
            'mimetype': _guess_image_mime(rec.filename),
            'data_base64': raw.decode('ascii') if isinstance(raw, bytes) else raw,
        }
