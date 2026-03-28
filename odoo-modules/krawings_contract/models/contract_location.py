from odoo import models, fields, api


class ContractLocation(models.Model):
    _name = 'krawings.contract.location'
    _description = 'Contract Location'
    _order = 'name'
    _inherit = ['mail.thread']

    name = fields.Char(string='Location Name', required=True, tracking=True)
    code = fields.Char(string='Short Code', help='Short code for the location, e.g. GBM38')
    address = fields.Text(string='Address')
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    active = fields.Boolean(default=True)

    contract_ids = fields.One2many('krawings.contract', 'location_id', string='Contracts')
    contract_count = fields.Integer(string='Contract Count', compute='_compute_contract_count')

    @api.depends('contract_ids')
    def _compute_contract_count(self):
        for rec in self:
            rec.contract_count = len(rec.contract_ids)
