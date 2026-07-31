# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _


class PosConfig(models.Model):
    _inherit = 'pos.config'

    manager_email_address = fields.Char(string='POS Manager Email Address')
