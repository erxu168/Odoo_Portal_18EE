from odoo import models, fields, api
import uuid
from random import choice

class PosConfig(models.Model):
    _inherit = 'pos.config'

    alternate_config_id = fields.Many2one('pos.config')
    evaluate_scores = fields.Boolean(default=False)
    fiskaly_qualify_points = fields.Integer(default=0)
    payment_method_ids = fields.Many2many('pos.payment.method', string='Payment Methods', default=lambda self: self._default_payment_methods(), copy=False, compute='_compute_payment_methods', store=True)

    def _get_forbidden_change_fields(self):
        res = super()._get_forbidden_change_fields()
        res.extend([
            'evaluate_scores',
            'alternate_config_id',
            'fiskaly_qualify_points',
        ])
        return res

    @api.depends('alternate_config_id')
    def _compute_payment_methods(self):
        for config in self:
            if config.alternate_config_id:
                alt_config = config.alternate_config_id
                for method in config.payment_method_ids:
                    alternate_method = alt_config.payment_method_ids.filtered(lambda m: m.name == method.name and m.type==method.type)
                    
                    # search for methods not in use. Cash is restricted to one per config so we treat specially
                    if not alternate_method and method.type!='cash':
                        alternate_method = self.env['pos.payment.method'].search([('company_id', '=', alt_config.company_id.id), ('name', '=', method.name), ('type', '=', method.type)])
                    elif not alternate_method:
                        alternate_method = self.env['pos.payment.method'].search([('company_id', '=', alt_config.company_id.id), ('name', '=', method.name), ('type', '=', method.type), ('config_ids', '=', False)])

                    if not alternate_method:
                        alternate_method = self.env['pos.payment.method'].sudo().with_company(config.alternate_config_id.company_id).create({
                            'name': method.name,
                            'split_transactions': method.split_transactions,
                            'journal_id': self._create_alternate_journal(method, alt_config.company_id).id
                        })
                        alt_config.payment_method_ids += alternate_method

    def _create_alternate_journal(self, payment_method, company_id):
        # creates a journal in the alternate company that will be used for the new payment method
        journal_id = payment_method.journal_id
        if not journal_id:
            return journal_id # return empty object
        
        return self.env['account.journal'].with_company(company_id).create({
            'type': journal_id.type,
            'name': journal_id.name,
        })

    def _l10n_de_create_tss_process(self):
        tss_id = str(uuid.uuid4())
        local_tss = self.search([('company_id', '=', self.company_id.id), ('l10n_de_fiskaly_tss_id', '!=', False)])
        db_uuid = self.env['ir.config_parameter'].sudo().get_param('database.uuid')

        # This line checks database subscription amongst other things
        # self.company_id._l10n_de_fiskaly_iap_rpc('/tss', {'tss_id': tss_id, 'db_uuid': db_uuid, 'tss': len(local_tss)})

        tss_creation_resp = self.company_id._l10n_de_fiskaly_kassensichv_rpc('PUT', '/tss/%s' % tss_id, {}) # Yes, Fiskaly is asking for a empty object...
        tss_puk = tss_creation_resp.json()['admin_puk']
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('PATCH', '/tss/%s' % tss_id, {'state': 'UNINITIALIZED'})
        tss_pin = ''.join(choice('0123456789') for _ in range(6))
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('PATCH', '/tss/%s/admin' % tss_id,
                                                         {'admin_puk': tss_puk, 'new_admin_pin': tss_pin})
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('POST', '/tss/%s/admin/auth' % tss_id, {'admin_pin': tss_pin})
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('PATCH', '/tss/%s' % tss_id, {'state': 'INITIALIZED'})

        # Client
        client_id = str(uuid.uuid4())
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('PUT', '/tss/%s/client/%s' % (tss_id, client_id), {'serial_number': self.uuid})
        self.company_id._l10n_de_fiskaly_kassensichv_rpc('POST', '/tss/%s/admin/logout' % tss_id, {'admin_pin': tss_pin})

        self.write({'l10n_de_fiskaly_tss_id': '|'.join([tss_id, tss_puk, tss_pin]), 'l10n_de_fiskaly_client_id': client_id})
