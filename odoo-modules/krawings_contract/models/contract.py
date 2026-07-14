from odoo import models, fields, api
from dateutil.relativedelta import relativedelta
import logging

_logger = logging.getLogger(__name__)

CONTRACT_TYPES = [
    ('rent', 'Lease / Mietvertrag'),
    ('insurance', 'Insurance / Versicherung'),
    ('electricity', 'Electricity / Strom'),
    ('gas', 'Gas / Erdgas'),
    ('telecom', 'Telecom'),
    ('garbage', 'Garbage / Entsorgung'),
    ('service', 'Service / Wartung'),
    ('supplier', 'Supplier / Lieferant'),
]

STATUS_TYPES = [
    ('active', 'Active'),
    ('expiring', 'Expiring Soon'),
    ('expired', 'Expired'),
    ('cancelled', 'Cancelled'),
]

PREMIUM_FREQUENCY = [
    ('monthly', 'Monthly'),
    ('quarterly', 'Quarterly'),
    ('semi_annually', 'Semi-Annually'),
    ('annually', 'Annually'),
    ('one_time', 'One-Time'),
]

KUENDIGUNGSFRIST_UNIT = [
    ('days', 'Days'),
    ('weeks', 'Weeks'),
    ('months', 'Months'),
]


class KrawingsContract(models.Model):
    _name = 'krawings.contract'
    _description = 'Krawings Contract'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'termination_deadline asc, end_date asc'

    # ── Core Fields ──
    name = fields.Char(
        string='Contract Name', required=True, tracking=True,
        help='Descriptive name for the contract'
    )
    contract_type = fields.Selection(
        CONTRACT_TYPES, string='Contract Type', required=True, tracking=True,
        help='Type of contract'
    )
    status = fields.Selection(
        STATUS_TYPES, string='Status', default='active',
        compute='_compute_status', store=True, tracking=True,
    )
    location_id = fields.Many2one(
        'krawings.contract.location', string='Location',
        required=True, tracking=True,
        help='Physical location this contract belongs to'
    )
    provider_id = fields.Many2one(
        'res.partner', string='Provider / Counterparty',
        tracking=True, help='The other party of the contract'
    )
    contract_number = fields.Char(
        string='Contract Number', tracking=True,
        help='Official contract reference number'
    )
    customer_id = fields.Char(
        string='Customer ID',
        help='Your customer/account number with the provider'
    )
    company_id = fields.Many2one(
        'res.company', string='Company',
        default=lambda self: self.env.company
    )
    creator_id = fields.Many2one(
        'res.users', string='Created By',
        default=lambda self: self.env.user
    )
    notes = fields.Text(string='Notes')

    # ── Date Fields ──
    start_date = fields.Date(
        string='Start Date', required=True, tracking=True
    )
    end_date = fields.Date(
        string='End Date', required=True, tracking=True
    )

    # ── Kuendigungsfrist ──
    kuendigungsfrist_value = fields.Integer(
        string='Kuendigungsfrist Value', default=3,
        help='Notice period before the contract can be terminated'
    )
    kuendigungsfrist_unit = fields.Selection(
        KUENDIGUNGSFRIST_UNIT, string='Kuendigungsfrist Unit',
        default='months'
    )
    termination_deadline = fields.Date(
        string='Termination Deadline',
        compute='_compute_termination_deadline', store=True,
        help='Last date to send cancellation notice'
    )

    # ── Auto-Renewal ──
    auto_renewal = fields.Boolean(
        string='Auto-Renewal', default=False, tracking=True
    )
    renewal_period_months = fields.Integer(
        string='Renewal Period (Months)', default=12,
        help='How many months the contract renews for if not cancelled'
    )

    # ── Financial ──
    premium_amount = fields.Float(
        string='Premium Amount', digits=(12, 2), tracking=True
    )
    premium_frequency = fields.Selection(
        PREMIUM_FREQUENCY, string='Payment Frequency',
        default='monthly', tracking=True
    )
    currency_id = fields.Many2one(
        'res.currency', string='Currency',
        default=lambda self: self.env.company.currency_id
    )
    annual_cost = fields.Float(
        string='Annual Cost', compute='_compute_annual_cost', store=True
    )

    # ── Portal / Login Fields ──
    portal_link = fields.Char(string='Portal Link')
    portal_login = fields.Char(string='Portal Login')
    portal_password = fields.Char(string='Portal Password')

    # ── Alert Tracking ──
    alert_90_sent = fields.Boolean(string='90-Day Alert Sent', default=False)
    alert_60_sent = fields.Boolean(string='60-Day Alert Sent', default=False)
    alert_30_sent = fields.Boolean(string='30-Day Alert Sent', default=False)

    # ── Type-Specific: Rent ──
    monthly_rent = fields.Float(string='Monthly Rent (EUR)', digits=(12, 2))
    maintenance_fee = fields.Float(string='Maintenance Fee (EUR)', digits=(12, 2))
    total_rent = fields.Float(
        string='Total Rent (EUR)',
        compute='_compute_total_rent', store=True
    )
    landlord_id = fields.Many2one(
        'res.partner', string='Landlord',
        help='Only for rent contracts'
    )

    # ── Type-Specific: Electricity / Gas ──
    meter_id = fields.Char(string='Meter ID')
    kw_unit_cost = fields.Float(string='kW Unit Cost (EUR)', digits=(12, 6))
    monthly_fee = fields.Float(string='Monthly Fee (EUR)', digits=(12, 2))
    monthly_installment = fields.Float(string='Monthly Installment (EUR)', digits=(12, 2))
    verification_code = fields.Char(string='Verification Code')

    # ── Type-Specific: Insurance ──
    insurance_type = fields.Char(string='Insurance Type')
    insurance_id_number = fields.Char(string='Insurance ID / Policy Number')

    # ── Type-Specific: Telecom ──
    phone_numbers = fields.Text(string='Phone Numbers')
    verification_pin = fields.Char(string='Verification PIN')

    # ── Type-Specific: Garbage ──
    container_size = fields.Char(string='Container Size')
    cost_per_container = fields.Float(string='Cost per Container', digits=(12, 2))
    pickup_days = fields.Char(
        string='Pickup Days',
        help='e.g. Monday, Thursday'
    )
    service_type = fields.Char(string='Service Type')

    # ── AI Scan Metadata ──
    ai_scanned = fields.Boolean(string='AI Scanned', default=False)
    ai_confidence = fields.Float(string='AI Confidence Score', digits=(5, 2))
    ai_scan_date = fields.Datetime(string='AI Scan Date')

    # ── Computed Fields ──

    @api.depends('monthly_rent', 'maintenance_fee')
    def _compute_total_rent(self):
        for rec in self:
            rec.total_rent = (rec.monthly_rent or 0.0) + (rec.maintenance_fee or 0.0)

    @api.depends('end_date', 'kuendigungsfrist_value', 'kuendigungsfrist_unit')
    def _compute_termination_deadline(self):
        for rec in self:
            if not rec.end_date or not rec.kuendigungsfrist_value:
                rec.termination_deadline = False
                continue
            val = rec.kuendigungsfrist_value
            unit = rec.kuendigungsfrist_unit or 'months'
            if unit == 'days':
                delta = relativedelta(days=val)
            elif unit == 'weeks':
                delta = relativedelta(weeks=val)
            else:
                delta = relativedelta(months=val)
            rec.termination_deadline = rec.end_date - delta

    @api.depends('premium_amount', 'premium_frequency')
    def _compute_annual_cost(self):
        multipliers = {
            'monthly': 12,
            'quarterly': 4,
            'semi_annually': 2,
            'annually': 1,
            'one_time': 0,
        }
        for rec in self:
            mult = multipliers.get(rec.premium_frequency, 1)
            rec.annual_cost = (rec.premium_amount or 0.0) * mult

    @api.depends('end_date', 'termination_deadline')
    def _compute_status(self):
        today = fields.Date.today()
        for rec in self:
            if not rec.end_date:
                rec.status = 'active'
                continue
            if rec.end_date < today:
                rec.status = 'expired'
            elif rec.termination_deadline and rec.termination_deadline <= today + relativedelta(days=90):
                rec.status = 'expiring'
            else:
                rec.status = 'active'

    # ── Cron: Check Kuendigungsfrist Alerts ──

    @api.model
    def _cron_check_termination_alerts(self):
        """Check all active contracts for upcoming termination deadlines.
        Send activity reminders at 90, 60, and 30 days before the deadline."""
        today = fields.Date.today()
        contracts = self.search([
            ('status', 'in', ['active', 'expiring']),
            ('termination_deadline', '!=', False),
        ])
        activity_type = self.env.ref('mail.mail_activity_data_todo', raise_if_not_found=False)
        if not activity_type:
            return

        for contract in contracts:
            deadline = contract.termination_deadline
            days_left = (deadline - today).days

            if days_left <= 30 and not contract.alert_30_sent:
                contract._create_alert_activity(
                    activity_type, deadline,
                    f'URGENT: Kuendigungsfrist for "{contract.name}" expires in {days_left} days!'
                )
                contract.alert_30_sent = True
            elif days_left <= 60 and not contract.alert_60_sent:
                contract._create_alert_activity(
                    activity_type, deadline,
                    f'Reminder: Kuendigungsfrist for "{contract.name}" expires in {days_left} days.'
                )
                contract.alert_60_sent = True
            elif days_left <= 90 and not contract.alert_90_sent:
                contract._create_alert_activity(
                    activity_type, deadline,
                    f'Upcoming: Kuendigungsfrist for "{contract.name}" expires in {days_left} days.'
                )
                contract.alert_90_sent = True

    def _create_alert_activity(self, activity_type, deadline, summary):
        self.ensure_one()
        self.activity_schedule(
            act_type_xmlid='mail.mail_activity_data_todo',
            date_deadline=deadline,
            summary=summary,
            user_id=self.creator_id.id or self.env.uid,
        )
