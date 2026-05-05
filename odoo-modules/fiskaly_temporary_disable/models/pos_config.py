from odoo import models

class PosConfig(models.Model):
    _inherit = 'pos.config'

    def _l10n_de_check_fiskaly_api_key_secret(self):
        pass

    def _l10n_de_check_fiskaly_tss_client_ids(self):
        pass
