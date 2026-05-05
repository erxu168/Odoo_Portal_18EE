from odoo import models, fields, api, _

DEFAULT_ENDPOINT = 'https://l10n-de-pos.api.odoo.com/api/l10n_de_pos'


class ResCompany(models.Model):
    _inherit = 'res.company'

    is_alternate_company = fields.Boolean(default=False)
    closing_time = fields.Datetime()
    