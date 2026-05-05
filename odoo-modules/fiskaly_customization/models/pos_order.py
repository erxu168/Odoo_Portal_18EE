from odoo import models, fields, api, _
import json


class PosOrder(models.Model):
    _inherit = 'pos.order'

    is_applicable = fields.Boolean(default=False)
    is_sent_to_fiskaly = fields.Boolean(default=False)
    bewirtungsbeleg = fields.Boolean(default=False)
    upload_json = fields.Char()
    time_paid = fields.Datetime(compute='_compute_time_paid')

    @api.model
    def sync_from_ui(self, orders):
        ''' details of finalized order has to be modified because of possibility of fiskaly parameters change'''
        for order in orders:
            if not self.env.company.l10n_de_is_germany_and_fiskaly() or not order.get('fiskaly_uuid'):
                continue
            existing_order = None

            existing_order = self.env['pos.order'].search([('uuid', '=', order.get('uuid'))])
            
            if not existing_order:
                return super().sync_from_ui(orders)
            
            # only fiskaly fields should be updated. Updating others might be dangerous
            self._update_fiskaly_fields(order, existing_order)
        return super().sync_from_ui(orders)

    def _update_fiskaly_fields(self, order, order_id):
        order_id.write({key: value for key, value in order.items() if key not in self._fiskaly_fields()})

    def _fiskaly_fields(self):
        return [
            'l10n_de_fiskaly_transaction_uuid',
            'l10n_de_fiskaly_transaction_number',
            'l10n_de_fiskaly_time_start',
            'l10n_de_fiskaly_time_end',
            'l10n_de_fiskaly_certificate_serial',
            'l10n_de_fiskaly_timestamp_format',
            'l10n_de_fiskaly_signature_value',
            'l10n_de_fiskaly_signature_algorithm',
            'l10n_de_fiskaly_signature_public_key',
            'l10n_de_fiskaly_client_serial_number',
            'is_applicable',
            'is_sent_to_fiskaly',
            'bewirtungsbeleg',
        ]
    
    def _compute_time_paid(self):
        for o in self:
            if self.payment_ids:
                o.time_paid = self.payment_ids[0].create_date
            else:
                o.time_paid = False

    def retrieve_keys(self):
        orders = self.search([
            ('is_applicable', '=', False), 
            ('l10n_de_fiskaly_signature_public_key', '!=', False),
            ('l10n_de_fiskaly_client_serial_number', '!=', False),
        ], limit=1)
        return {
            'l10n_de_fiskaly_signature_public_key': orders[0].l10n_de_fiskaly_signature_public_key if orders else False,
            'l10n_de_fiskaly_client_serial_number': orders[0].l10n_de_fiskaly_client_serial_number if orders else False,
        }
    
    def get_transaction_number(self):
        return self.env['pos.order'].search_count([
            ('state', '!=', 'cancel'), 
            ('l10n_de_fiskaly_transaction_uuid', '!=', False), 
        ])
