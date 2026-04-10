from odoo import models, fields, api


class KrawingsSupplierLogin(models.Model):
    _name = 'krawings.supplier.login'
    _description = 'Supplier Portal Login'
    _order = 'partner_id, company_id'

    partner_id = fields.Many2one(
        'res.partner',
        string='Supplier',
        required=True,
        ondelete='cascade',
        domain=[('supplier_rank', '>', 0)],
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company,
    )
    username = fields.Char(string='Username', required=True)
    password = fields.Char(string='Password', required=True)
    website_url = fields.Char(string='Login URL')
    notes = fields.Text(string='Notes')

    _sql_constraints = [
        (
            'partner_company_unique',
            'UNIQUE(partner_id, company_id)',
            'A login already exists for this supplier and company.',
        ),
    ]
