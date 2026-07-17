from odoo import api, fields, models


class PosBill(models.Model):
    _inherit = "pos.bill"

    is_coin = fields.Boolean(
        string="Is a coin",
        help="If checked, this denomination is a coin: at register closing it "
        "can be counted either by quantity or by total value. Notes (bills) "
        "are always counted by quantity.",
    )

    @api.model
    def _load_pos_data_fields(self, config_id):
        field_list = super()._load_pos_data_fields(config_id)
        if "is_coin" not in field_list:
            field_list.append("is_coin")
        return field_list
