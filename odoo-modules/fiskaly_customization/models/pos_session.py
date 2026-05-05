from odoo import models, fields, api, _
from odoo.exceptions import UserError

from datetime import datetime, timedelta
import requests
from requests.exceptions import ConnectTimeout
import ast


class PosSession(models.Model):
    _inherit = 'pos.session'

    alternate_session_id = fields.Many2one('pos.session', readonly=False)
    created_from_session_id = fields.Many2one('pos.session', readonly=False)

    @api.model_create_multi
    def create(self, vals_list):
        sessions = super().create(vals_list)
        for session in sessions:
            config_id = session.config_id.alternate_config_id
            if config_id:
                # force close if open
                latest_session = self.env['pos.session'].sudo().search([('company_id', '=', config_id.company_id.id), ('config_id', '=', config_id.id)], order='id desc',  limit=1)
                if latest_session.state == 'opening_control':
                    values={'state': 'opened'}
                    if not latest_session.start_at:
                        values['start_at'] = fields.Datetime.now()
                    latest_session.write(values)
                if latest_session.state == 'opened':
                    latest_session.action_pos_session_closing_control()
                if latest_session.state == 'closing_control':
                    latest_session.action_pos_session_close()

                self.env['pos.session'].sudo().with_company(config_id.alternate_config_id.company_id).create({
                    'config_id': config_id.id,
                    'created_from_session_id': session.id,
                })
                alternate_session = self.env['pos.session'].sudo().search([('created_from_session_id', '=', session.id)], limit=1)
                session.alternate_session_id = alternate_session
        return sessions

    def _validate_session(self, balancing_account=False, amount_to_balance=0, bank_payment_method_diffs=None):
        self = self.sudo()
        if self.alternate_session_id and not self.alternate_session_id.state == 'closed':
            if self.alternate_session_id.state == 'opening_control':
                values={'state': 'opened'}
                if not self.alternate_session_id.start_at:
                    values['start_at'] = fields.Datetime.now()
                self.alternate_session_id.write(values)
            self._move_orders()

            # This is necessary before attempting to close the alternate session.
            self.env.cr.commit()

        res = super()._validate_session(balancing_account, amount_to_balance, bank_payment_method_diffs)
        # we'll get a dict if an error occured and we have to return an action
        if isinstance(res, dict):
            return res
        if self.alternate_session_id and not self.alternate_session_id.state == 'closed':
            alt_res = None
            if self.alternate_session_id.state == 'opened':
                alt_res = self.alternate_session_id.action_pos_session_closing_control()
            if self.alternate_session_id.state == 'closing_control':
                alt_res = self.alternate_session_id.action_pos_session_close()
            if isinstance(alt_res, dict):
                return alt_res
            # if there was an error in "_check_balanced", all we had done up to this block
            # would be rolled back. My implementation of _close_session_action makes sure the 
            # alternate session is closed regardless. However we would need to revalidate the main session
            # again.
            # All this is to reduce overwriting methods and reduce errors for the user
            elif alt_res and self.alternate_session_id.state == 'closed' and self.state != 'closed':
                res = super()._validate_session(balancing_account, amount_to_balance, bank_payment_method_diffs)
        return res
    
    # Overwrite
    # We need to force the create method to use the sessions company 
    def _post_statement_difference(self, amount):
        if amount:
            if self.config_id.cash_control:
                st_line_vals = {
                    'journal_id': self.cash_journal_id.id,
                    'amount': amount,
                    'date': self.statement_line_ids.sorted()[-1:].date or fields.Date.context_today(self),
                    'pos_session_id': self.id,
                }

            if amount < 0.0:
                if not self.cash_journal_id.loss_account_id:
                    raise UserError(
                        _('Please go on the %s journal and define a Loss Account. This account will be used to record cash difference.',
                          self.cash_journal_id.name))

                st_line_vals['payment_ref'] = _("Cash difference observed during the counting (Loss) - closing")
                st_line_vals['counterpart_account_id'] = self.cash_journal_id.loss_account_id.id
            else:
                # self.cash_register_difference  > 0.0
                if not self.cash_journal_id.profit_account_id:
                    raise UserError(
                        _('Please go on the %s journal and define a Profit Account. This account will be used to record cash difference.',
                          self.cash_journal_id.name))

                st_line_vals['payment_ref'] = _("Cash difference observed during the counting (Profit) - closing")
                st_line_vals['counterpart_account_id'] = self.cash_journal_id.profit_account_id.id

            created_line = self.env['account.bank.statement.line'].with_company(self.company_id).create(st_line_vals)

            if created_line:
                created_line.move_id.message_post(body=_(
                    "Related Session: %(link)s",
                    link=self._get_html_link()
                ))
    
    # sudo to prevent access errors when closing alternate session with only one company enabled
    def action_pos_session_closing_control(self, balancing_account=False, amount_to_balance=0, bank_payment_method_diffs=None):
        self = self.sudo()
        return super().action_pos_session_closing_control(balancing_account=balancing_account, amount_to_balance=amount_to_balance, bank_payment_method_diffs=bank_payment_method_diffs)

    def _move_orders(self):
        '''Move applicable orders to alternate session'''
        self = self.sudo()
        orders = self.order_ids.filtered(lambda od: od.is_applicable)
        orders.write({
            'session_id': self.alternate_session_id.id,
            'company_id': self.alternate_session_id.company_id.id,
        })

        for payment in orders.payment_ids:
            alternate_method = self.alternate_session_id.config_id.payment_method_ids.filtered(lambda m: m.name == payment.payment_method_id.name)
            if alternate_method:
                alternate_method = alternate_method[0]
            else:
                # or just choose any to prevent error. It dosent matter
                alternate_method = self.alternate_session_id.config_id.payment_method_ids[0]
            if not alternate_method:
                raise UserError(f'Please configure a payment method for {self.alternate_session_id.config_id.name}')
            payment.payment_method_id = alternate_method

        for orderline in orders.lines:
            new_tax = orderline.sudo().product_id.taxes_id.filtered(lambda tx: tx.company_id == self.alternate_session_id.company_id)
            new_tax = new_tax[0] if new_tax else False
            orderline.tax_ids = new_tax
            orderline._get_tax_ids_after_fiscal_position()

    def _close_session_action(self, amount_to_balance):
        default_account = self._get_balancing_account()
        # if its used as an alternate config somewhere, its most likely the alternate company 
        if self.env['pos.config'].search([('alternate_config_id', '=', self.config_id.id)]):
            # noone cares where this ends up in the alternate company. 
            # Lets priortize preventing error msgs instead
            return self.action_pos_session_closing_control(
                        default_account, amount_to_balance
                    )
        else:
            return super()._close_session_action(amount_to_balance)
        
    def _loader_params_survey_question_answer(self):
        res = super()._loader_params_survey_question_answer()
        res['search_params']['fields'].extend(['payment_type', 'receipt_type'])
        return res
