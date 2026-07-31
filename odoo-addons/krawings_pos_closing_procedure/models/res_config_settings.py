# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    manager_email_address = fields.Char(related='pos_config_id.manager_email_address', readonly=False)
