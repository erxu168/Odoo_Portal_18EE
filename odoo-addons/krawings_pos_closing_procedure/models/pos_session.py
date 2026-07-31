# -*- coding: utf-8 -*-
import logging
from odoo import api, fields, models, tools, _
from odoo.exceptions import UserError
from pytz import timezone, UTC

_logger = logging.getLogger(__name__)


class PosSession(models.Model):
    _inherit = 'pos.session'

    module_pos_hr = fields.Boolean()
    closing_cashier_name = fields.Char(compute='_compute_closing_cashier_details')
    closing_cashier_email = fields.Char(compute='_compute_closing_cashier_details')
    closing_employee_id = fields.Many2one('hr.employee', string='Closing Cashier')
    closing_user_id = fields.Many2one('res.users', string='Closing Cashier')
    closing_staff_name = fields.Char(string='Closing Staff (signed)')
    total_sales = fields.Float(string='Total Sales', compute='_compute_order_summary', store=True)
    total_tips = fields.Float(string='Total Tips', compute='_compute_order_summary', store=True)
    sent_daily_summary = fields.Boolean(string='Sent Daily Summary', default=False)
    stop_at_user_tz = fields.Datetime(compute='_compute_date_in_usertz')
    start_at_user_tz = fields.Datetime(compute='_compute_date_in_usertz')

    def can_close_session(self):
        self.ensure_one()
        check_closing_session = self._cannot_close_session()
        if check_closing_session:
            open_order_ids = self.order_ids.filtered(lambda o: o.state == 'draft').ids
            check_closing_session['open_order_ids'] = open_order_ids
        return check_closing_session or { 'successful': True }

    def _compute_date_in_usertz(self):
        for record in self:
            user_tz = self.env.context.get('tz') or 'UTC'
            user_timezone = timezone(user_tz)

            if record.stop_at and record.start_at:
                stop_at_utc = fields.Datetime.from_string(record.stop_at).replace(tzinfo=None)
                start_at_utc = fields.Datetime.from_string(record.start_at).replace(tzinfo=None)

                stop_at_aware = UTC.localize(stop_at_utc).astimezone(user_timezone)
                start_at_aware = UTC.localize(start_at_utc).astimezone(user_timezone)

                record.stop_at_user_tz = stop_at_aware.replace(tzinfo=None)
                record.start_at_user_tz = start_at_aware.replace(tzinfo=None)
            else:
                record.stop_at_user_tz = False
                record.start_at_user_tz = False

    def _compute_closing_cashier_details(self):
        for session in self:
            session.closing_cashier_name = session.closing_employee_id.display_name if session.closing_employee_id else session.closing_user_id.display_name
            session.closing_cashier_email = session.closing_employee_id.work_email if session.closing_employee_id else session.closing_user_id.partner_id.email

    @api.depends('order_ids', 'order_ids.lines.price_subtotal_incl', 'state')
    def _compute_order_summary(self):
        for session in self:
            # Count tips from the configured tip product lines, NOT order.tip_amount.
            # tip_amount is only populated when a tip is added through the card/terminal
            # "add a tip" flow; tips rung up directly on the Tips product leave tip_amount
            # at 0. Summing tip_amount therefore under-reports the day's tips
            # (e.g. Ssam session POS/03140: tip_amount=59.74 vs the true 109.10 on the
            # Tips product lines). The Odoo Z-report already sums the product lines, so
            # this keeps the closing email consistent with it.
            tip_product = session.config_id.tip_product_id
            total_tips = 0.0
            if tip_product:
                tip_lines = session.order_ids.lines.filtered(
                    lambda line: line.product_id == tip_product
                )
                total_tips = sum(tip_lines.mapped('price_subtotal_incl'))
            session.total_tips = total_tips
            session.total_sales = sum(session.order_ids.mapped('amount_total')) - total_tips

    def update_closing_cashier(self, cashier_id, module_pos_hr):
        # Prevent closing the session again if it was already closed
        if self.state == 'closed':
            raise UserError(_('This session is already closed.'))
        self.module_pos_hr = module_pos_hr
        if module_pos_hr and cashier_id:
            self.write({'closing_employee_id': int(cashier_id)})
        elif not module_pos_hr and cashier_id:
            self.write({'closing_user_id': int(cashier_id)})

    def set_closing_staff_name(self, name):
        # Store the name the staff typed on the closure disclaimer window. This is
        # the signed accountability name shown as "Closing Staff" in the daily
        # sales email. Called via RPC from the POS UI before the session closes.
        if self.state == 'closed':
            raise UserError(_('This session is already closed.'))
        self.write({'closing_staff_name': (name or '').strip()})

    def send_daily_sale_summary(self):
        self.ensure_one()
        if self.sent_daily_summary:
            return

        manager_email = self.config_id.manager_email_address
        if not manager_email:
            _logger.warning(
                "POS session %s: no manager email configured on POS config '%s'; "
                "daily sales summary not sent.",
                self.id, self.config_id.display_name,
            )
            return

        try:
            template = self.env.ref('krawings_pos_closing_procedure.email_template_daily_sales')
            template.with_context(manager_email=manager_email).send_mail(self.id, force_send=True)
            # Only flag the summary as sent once it has actually gone out, so a
            # send failure does not permanently suppress the report.
            self.sent_daily_summary = True
        except Exception:
            _logger.exception(
                "POS session %s: failed to send daily sales summary email; "
                "session close will continue.", self.id,
            )
            return

        # Ignore sub-cent rounding noise so a clean close does not trigger a
        # spurious 'serious discrepancy' warning to the cashier.
        if self.currency_id.is_zero(self.cash_register_difference):
            return
        if not self.closing_cashier_email:
            _logger.warning(
                "POS session %s: cash discrepancy of %s but the closing cashier "
                "has no email; discrepancy warning not sent.",
                self.id, self.cash_register_difference,
            )
            return
        try:
            discrepancy_template = self.env.ref(
                'krawings_pos_closing_procedure.email_template_warning_discrepancies'
            )
            discrepancy_template.send_mail(self.id, force_send=True)
        except Exception:
            _logger.exception(
                "POS session %s: failed to send cash discrepancy warning email.",
                self.id,
            )

    def get_closing_control_data(self):
        res = super().get_closing_control_data()
        cash_tips = 0.0
        bank_tips = 0.0
        total_tips = 0.0
        # The POS does not record which payment method a tip was paid with, so
        # split each order's tip across cash vs bank in proportion to how the
        # order itself was settled. For a single-method order this is exact;
        # only split-payment orders are approximated. (Previously the whole tip
        # was attributed to one guessed method, which misclassified split bills.)
        for order in self.order_ids:
            if not order.tip_amount:
                continue
            total_tips += order.tip_amount
            settled_payments = order.payment_ids.filtered(
                lambda p: p.payment_method_id.type != 'pay_later'
            )
            total_paid = sum(settled_payments.mapped('amount'))
            if not total_paid:
                continue
            cash_paid = sum(
                settled_payments.filtered(lambda p: p.payment_method_id.type == 'cash').mapped('amount')
            )
            cash_share = cash_paid / total_paid
            cash_tips += order.tip_amount * cash_share
            bank_tips += order.tip_amount * (1 - cash_share)

        orders = self._get_closed_orders()
        payments = orders.payment_ids.filtered(lambda p: p.payment_method_id.type != "pay_later")
        # Sum cash taken across ALL cash-type payment methods, not just the first
        # one. A register configured with more than one cash method previously
        # under-reported expected cash and raised a false shortage at closing.
        total_default_cash_payment_amount = sum(
            payments.filtered(lambda p: p.payment_method_id.type == 'cash').mapped('amount')
        )

        # Identify opening cash-difference moves resiliently: normalise case and
        # whitespace and match as a substring, rather than requiring the exact
        # translated label. The previous exact match silently failed - and the
        # move was then miscounted as a regular cash in/out - whenever the
        # statement label had extra spacing or edited text. (Residual limit: a
        # fully re-worded or differently-translated label still won't match.)
        opening_diff_markers = tuple(
            marker.strip().lower()
            for marker in (
                _("Cash difference observed during the counting (Loss)") + _(' - opening'),
                _("Cash difference observed during the counting (Profit)") + _(' - opening'),
            )
        )
        cash_in_count = 0
        cash_out_count = 0
        cash_in_out_list = []
        opening_cash_discrepancy = 0.0
        for i, cash_move in enumerate(self.sudo().statement_line_ids.sorted('create_date'), start=1):
            payment_ref = (cash_move.payment_ref or '').strip().lower()
            if any(marker in payment_ref for marker in opening_diff_markers):
                opening_cash_discrepancy += cash_move.amount
                continue
            _id = f'cash_in_out_{i}'
            if cash_move.amount > 0:
                cash_in_count += 1
                name = f'+ Cash in {cash_in_count}'
            else:
                cash_out_count += 1
                name = f'+ Cash out {cash_out_count}'
            cash_in_out_list.append({
                'id': _id, 
                'name': cash_move.payment_ref if cash_move.payment_ref else name,
                'amount': cash_move.amount,
                'notation': '+',
            })

        opening_cash = self.cash_register_balance_start - opening_cash_discrepancy
        cash_in_out_total = sum([item['amount'] for item in cash_in_out_list])
        expected_closing_cash = self.cash_register_balance_start + cash_in_out_total + total_default_cash_payment_amount

        tip_amount = sum(orders.mapped('tip_amount'))
        amount_total = sum(orders.mapped('amount_total'))
        tip_percentage = 0 if amount_total==0.0 else (tip_amount / amount_total) * 100
        cash_tips_formatted = tools.format_amount(self.env, cash_tips, self.currency_id)
        bank_tips_formatted = tools.format_amount(self.env, bank_tips, self.currency_id)

        # total sales
        custom_display = {
            'sales_data': {
                'name': 'Total Sales',
                'amount': res['orders_details']['amount'],
                'details': [
                    {'name': 'Sales', 'amount': amount_total - tip_amount, 'details': [], 'notation': '+'},
                    {
                        'name': f'{tip_percentage:.2f}% Tips ({cash_tips_formatted} Cash, {bank_tips_formatted} Bank)', 
                        'amount': tip_amount, 
                        'notation': '+', 
                        'details': []},
                ]
            },
            'payments_data': {
                'name': 'Payments',
                'amount': sum(orders.payment_ids.mapped('amount')),
                'details': [{
                    'name': pm.name,
                    'amount': sum(orders.payment_ids.filtered(lambda p: p.payment_method_id == pm).mapped('amount')),
                    'notation': '+',
                    'details': []
                } for pm in self.payment_method_ids],
            },
            'cash_details': {
                'name': 'Closing Cash / Next Day Opening',
                'amount': expected_closing_cash, # to be determined later
                'details': [
                    {'id': 'end_of_day_cash_out', 'name': 'End of Day Cash Out', 'amount': 0.0, 'details': [], 'notation': '-'}, # TBD
                    {'id': 'closing_cash_discrepancy', 'name': 'Closing Cash Discrepancy', 'amount': 0.0, 'details': [], 'notation': '-'}, # TBD
                    {
                        'id': 'expected_closing_cash', 
                        'name': 'Expected Closing Cash',
                        'amount': expected_closing_cash,
                        'notation': '+',
                        'details': [
                            {
                                'id': 'actual_opening', 
                                'name': 'Actual Opening',
                                'amount': self.cash_register_balance_start,
                                'notation': '+',
                                'details': [
                                    {'id': 'opening_cash', 'name': 'Opening Cash', 'amount': opening_cash, 'details': [], 'notation': '+',},
                                    {'id': 'opening_cash_discrepancy', 'name': 'Opening Cash Discrepancy', 'amount': opening_cash_discrepancy, 'details': [], 'notation': '-',},
                                ]
                            },
                            {
                                'id': 'cash_in_out', 
                                'name': 'Cash In/Out',
                                'amount': cash_in_out_total,
                                'notation': '+',
                                'details': cash_in_out_list
                            },
                            {
                                'id': 'actual_sales_cash', 
                                'name': 'Actual Sales Cash',
                                'amount': total_default_cash_payment_amount,
                                'notation': '+',
                                'details': [
                                    {'id': 'cash_tips', 'name': 'Cash Tips', 'amount': cash_tips, 'details': [], 'notation': '+',},
                                    {'id': 'other_cash_payments', 'name': 'Other Cash Payments', 'amount': total_default_cash_payment_amount - cash_tips, 'details': [], 'notation': '+',},
                                ]
                            }
                        ],
                    },
                ],
            }
        }
        res['orders_details']['custom_display'] = custom_display
        return res

    def _validate_session(self, balancing_account=False, amount_to_balance=0, bank_payment_method_diffs=None):
        res = super()._validate_session(balancing_account, amount_to_balance, bank_payment_method_diffs)
        self.send_daily_sale_summary()
        return res
