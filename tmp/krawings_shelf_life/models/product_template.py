from odoo import fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    x_shelf_life_chilled_days = fields.Integer(
        string='Shelf Life — Chilled (days)',
        default=0,
        help='Days the product lasts when stored chilled. 0 = not set; portal labels print without an expiry date.',
    )
    x_shelf_life_frozen_days = fields.Integer(
        string='Shelf Life — Frozen (days)',
        default=0,
        help='Days the product lasts when stored frozen. 0 = not set; portal labels print without an expiry date.',
    )
