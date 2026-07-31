# -*- coding: utf-8 -*-
from odoo import api, fields, models, _


class ReportSaleDetails(models.AbstractModel):
    _inherit = 'report.point_of_sale.report_saledetails'

    @api.model
    def get_sale_details(self, date_start=False, date_stop=False, config_ids=False, session_ids=False):
        res = super().get_sale_details(date_start, date_stop, config_ids, session_ids)
        if session_ids and len(session_ids) == 1:
            session = self.env['pos.session'].browse(session_ids[0])
            res['closing_cashier'] = session.closing_cashier_name
        return res
