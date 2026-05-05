from odoo import models

class PosSession(models.Model):
    _inherit = 'pos.session'

    def _l10n_de_create_cash_point_closing_json(self, orders):
        orders = orders.filtered(lambda o:o.l10n_de_fiskaly_transaction_uuid)
        return super()._l10n_de_create_cash_point_closing_json(orders)
