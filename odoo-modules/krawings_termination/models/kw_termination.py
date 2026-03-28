from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
from dateutil.relativedelta import relativedelta
from datetime import date, timedelta
import logging

_logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Section 622 BGB - Statutory notice periods (employer -> employee)
# -------------------------------------------------------------------
# During probation (max 6 months): 2 weeks from any day
# < 2 years:  4 weeks to 15th or end of calendar month
# 2+ years:   1 month to end of calendar month
# 5+ years:   2 months to end of calendar month
# 8+ years:   3 months to end of calendar month
# 10+ years:  4 months to end of calendar month
# 12+ years:  5 months to end of calendar month
# 15+ years:  6 months to end of calendar month
# 20+ years:  7 months to end of calendar month
# -------------------------------------------------------------------

BGB_622_PERIODS = [
    # (min_years, months, description_de, description_en)
    (20, 7, '7 Monate zum Monatsende', '7 months to end of month'),
    (15, 6, '6 Monate zum Monatsende', '6 months to end of month'),
    (12, 5, '5 Monate zum Monatsende', '5 months to end of month'),
    (10, 4, '4 Monate zum Monatsende', '4 months to end of month'),
    (8, 3, '3 Monate zum Monatsende', '3 months to end of month'),
    (5, 2, '2 Monate zum Monatsende', '2 months to end of month'),
    (2, 1, '1 Monat zum Monatsende', '1 month to end of month'),
]

TERMINATION_TYPES = [
    ('ordentlich', 'Ordentliche Kuendigung'),
    ('ordentlich_probezeit', 'Ordentliche Kuendigung (Probezeit)'),
    ('fristlos', 'Fristlose Kuendigung'),
    ('aufhebung', 'Aufhebungsvertrag'),
    ('bestaetigung', 'Kuendigungsbestaetigung'),
]

CALC_METHODS = [
    ('bgb', 'Par. 622 BGB statutory (to 15th / month-end)'),
    ('receipt', 'From receipt date (tenure-scaled from delivery)'),
]

TERMINATION_STATES = [
    ('draft', 'Draft'),
    ('confirmed', 'Confirmed'),
    ('signed', 'Signed'),
    ('archived', 'Archived'),
    ('cancelled', 'Cancelled'),
]


class KwTermination(models.Model):
    _name = 'kw.termination'
    _description = 'Employee Termination Record'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'letter_date desc, id desc'
    _rec_name = 'display_name'

    # ----- Core fields -----
    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True,
        tracking=True, ondelete='restrict',
    )
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company,
        tracking=True,
    )
    termination_type = fields.Selection(
        TERMINATION_TYPES, string='Type', required=True,
        tracking=True,
    )
    calc_method = fields.Selection(
        CALC_METHODS, string='Calculation Method',
        default='bgb', required=True, tracking=True,
    )
    state = fields.Selection(
        TERMINATION_STATES, string='Status',
        default='draft', required=True, tracking=True,
    )

    # ----- Date fields -----
    letter_date = fields.Date(
        string='Letter Date', default=fields.Date.today,
        required=True, tracking=True,
    )
    receipt_date = fields.Date(
        string='Receipt Date',
        help='Date the employee received the letter (for receipt-based calculation)',
    )
    notice_period_text = fields.Char(
        string='Notice Period', compute='_compute_dates', store=True,
    )
    last_working_day = fields.Date(
        string='Last Working Day', compute='_compute_dates',
        store=True, readonly=False, tracking=True,
    )
    departure_date = fields.Date(
        string='Departure Date', related='last_working_day',
        store=True, readonly=True,
    )

    # ----- Employee snapshot -----
    employee_name = fields.Char(
        related='employee_id.name', store=True, string='Employee Name',
    )
    employee_street = fields.Char(string='Street')
    employee_city = fields.Char(string='City')
    employee_zip = fields.Char(string='ZIP')
    employee_start_date = fields.Date(
        string='Employment Start', compute='_compute_employee_info', store=True,
    )
    tenure_years = fields.Float(
        string='Tenure (years)', compute='_compute_employee_info', store=True,
    )
    in_probation = fields.Boolean(
        string='In Probation', compute='_compute_employee_info', store=True,
    )
    probation_end = fields.Date(
        string='Probation End', compute='_compute_employee_info', store=True,
    )

    # ----- Fristlose specific -----
    incident_date = fields.Date(
        string='Incident Date',
        help='Date employer learned of the incident (fristlose only)',
    )
    incident_description = fields.Text(
        string='Incident Description (internal)',
        help='Not included in the termination letter',
    )
    incident_overdue = fields.Boolean(
        string='14-day Deadline Exceeded',
        compute='_compute_incident_overdue', store=True,
    )

    # ----- Aufhebungsvertrag specific -----
    include_severance = fields.Boolean(string='Include Abfindung')
    severance_amount = fields.Float(string='Abfindung Amount')
    garden_leave = fields.Boolean(string='Freistellung (Garden Leave)')
    zeugnis_grade = fields.Selection([
        ('1', 'Sehr gut'),
        ('2', 'Gut'),
        ('3', 'Befriedigend'),
        ('4', 'Ausreichend'),
    ], string='Arbeitszeugnis Grade', default='2')

    # ----- Bestaetigung specific -----
    resignation_received_date = fields.Date(
        string='Resignation Received Date',
    )
    resignation_method = fields.Selection([
        ('letter', 'Letter'),
        ('email', 'Email'),
        ('verbal', 'Verbal'),
    ], string='Resignation Method')
    written_resignation_received = fields.Boolean(
        string='Written Resignation Received',
    )

    # ----- PDF / Sign -----
    pdf_attachment_id = fields.Many2one(
        'ir.attachment', string='Generated PDF',
    )
    sign_request_id = fields.Many2one(
        'sign.request', string='Sign Request',
    )
    sign_state = fields.Selection([
        ('not_started', 'Not Started'),
        ('employer_signed', 'Employer Signed'),
        ('fully_signed', 'Fully Signed'),
    ], string='Signature Status', default='not_started', tracking=True)

    # ----- Accountant -----
    sent_to_accountant = fields.Boolean(string='Sent to Accountant')
    sent_to_accountant_date = fields.Datetime(string='Sent Date')

    # ----- Display -----
    display_name = fields.Char(compute='_compute_display_name', store=True)

    @api.depends('employee_name', 'termination_type', 'letter_date')
    def _compute_display_name(self):
        type_labels = dict(TERMINATION_TYPES)
        for rec in self:
            parts = [rec.employee_name or 'New']
            if rec.termination_type:
                parts.append(type_labels.get(rec.termination_type, ''))
            if rec.letter_date:
                parts.append(str(rec.letter_date))
            rec.display_name = ' - '.join(parts)

    # -----------------------------------------------------------------
    # Compute: employee info from contract
    # -----------------------------------------------------------------
    @api.depends('employee_id', 'letter_date')
    def _compute_employee_info(self):
        for rec in self:
            emp = rec.employee_id
            if not emp:
                rec.employee_start_date = False
                rec.tenure_years = 0
                rec.in_probation = False
                rec.probation_end = False
                continue

            # Get start date from contract or kw_beschaeftigungsbeginn
            contract = self.env['hr.contract'].search([
                ('employee_id', '=', emp.id),
                ('state', '=', 'open'),
            ], limit=1, order='date_start asc')
            start = contract.date_start if contract else False
            if not start and hasattr(emp, 'kw_beschaeftigungsbeginn'):
                start = emp.kw_beschaeftigungsbeginn
            rec.employee_start_date = start

            # Tenure
            ref_date = rec.letter_date or date.today()
            if start:
                delta = relativedelta(ref_date, start)
                rec.tenure_years = delta.years + (delta.months / 12.0)
            else:
                rec.tenure_years = 0

            # Probation
            prob_end = False
            if hasattr(emp, 'kw_probezeit_bis') and emp.kw_probezeit_bis:
                prob_end = emp.kw_probezeit_bis
            elif contract and contract.trial_date_end:
                prob_end = contract.trial_date_end
            rec.probation_end = prob_end
            rec.in_probation = bool(prob_end and ref_date <= prob_end)

    # -----------------------------------------------------------------
    # Compute: notice period and last working day
    # -----------------------------------------------------------------
    @api.depends(
        'termination_type', 'calc_method', 'letter_date', 'receipt_date',
        'employee_start_date', 'tenure_years', 'in_probation',
        'resignation_received_date', 'incident_date',
    )
    def _compute_dates(self):
        for rec in self:
            if not rec.termination_type or not rec.letter_date:
                rec.notice_period_text = ''
                rec.last_working_day = False
                continue

            if rec.termination_type == 'fristlos':
                rec.notice_period_text = 'Sofort (fristlos)'
                rec.last_working_day = rec.letter_date

            elif rec.termination_type == 'aufhebung':
                rec.notice_period_text = 'Einvernehmlich vereinbart'
                # last_working_day is set manually for Aufhebungsvertrag

            elif rec.termination_type == 'bestaetigung':
                # Employee quit - calculate from their side
                # Employee always has 4 weeks to 15th or month-end
                ref = rec.resignation_received_date or rec.letter_date
                period_text, lwd = self._calc_employee_notice(ref)
                rec.notice_period_text = period_text
                rec.last_working_day = lwd

            elif rec.termination_type in ('ordentlich', 'ordentlich_probezeit'):
                if rec.in_probation or rec.termination_type == 'ordentlich_probezeit':
                    rec.notice_period_text, rec.last_working_day = \
                        self._calc_probation_notice(rec)
                else:
                    rec.notice_period_text, rec.last_working_day = \
                        self._calc_standard_notice(rec)

    def _calc_probation_notice(self, rec):
        """2 weeks from any day (probation)."""
        if rec.calc_method == 'receipt' and rec.receipt_date:
            base = rec.receipt_date
        else:
            base = rec.letter_date
        lwd = base + timedelta(days=14)
        return ('2 Wochen (Probezeit)', lwd)

    def _calc_standard_notice(self, rec):
        """Par. 622 BGB scaled by tenure."""
        tenure = rec.tenure_years or 0

        # Find the applicable period
        months = 0
        desc_en = '4 weeks to 15th or end of month'
        desc_de = '4 Wochen zum 15. oder Monatsende'
        is_base = True  # < 2 years uses the 4-week base rule

        for min_years, period_months, de, en in BGB_622_PERIODS:
            if tenure >= min_years:
                months = period_months
                desc_de = de
                desc_en = en
                is_base = False
                break

        if rec.calc_method == 'receipt' and rec.receipt_date:
            # From receipt: just add the duration
            base = rec.receipt_date
            if is_base:
                # < 2 years: 4 weeks = 28 days
                lwd = base + timedelta(days=28)
            else:
                # 2+ years: calendar months
                lwd = base + relativedelta(months=months)
            return (desc_en, lwd)
        else:
            # Par. 622 BGB statutory: snap to 15th or month-end
            base = rec.letter_date
            if is_base:
                # 4 weeks to 15th or end of month
                earliest = base + timedelta(days=28)
                lwd = self._snap_to_15th_or_end(earliest)
            else:
                # N months to end of month
                earliest = base + relativedelta(months=months)
                lwd = self._snap_to_month_end(earliest)
            return (desc_de, lwd)

    @staticmethod
    def _calc_employee_notice(ref_date):
        """Employee resignation: always 4 weeks to 15th or month-end."""
        earliest = ref_date + timedelta(days=28)
        lwd = KwTermination._snap_to_15th_or_end(earliest)
        return ('4 Wochen zum 15. oder Monatsende', lwd)

    @staticmethod
    def _snap_to_15th_or_end(d):
        """Snap a date to the next 15th or end of calendar month."""
        import calendar
        # Check 15th of current month
        fifteenth = d.replace(day=15)
        if fifteenth >= d:
            return fifteenth
        # End of current month
        last_day = calendar.monthrange(d.year, d.month)[1]
        end_of_month = d.replace(day=last_day)
        if end_of_month >= d:
            return end_of_month
        # 15th of next month
        next_month = d + relativedelta(months=1)
        return next_month.replace(day=15)

    @staticmethod
    def _snap_to_month_end(d):
        """Snap to the last day of the calendar month on or after d."""
        import calendar
        last_day = calendar.monthrange(d.year, d.month)[1]
        end_of_month = d.replace(day=last_day)
        if end_of_month >= d:
            return end_of_month
        # Next month end
        next_month = d + relativedelta(months=1)
        last_day = calendar.monthrange(next_month.year, next_month.month)[1]
        return next_month.replace(day=last_day)

    # -----------------------------------------------------------------
    # Compute: incident overdue (fristlose)
    # -----------------------------------------------------------------
    @api.depends('incident_date', 'letter_date')
    def _compute_incident_overdue(self):
        for rec in self:
            if rec.incident_date and rec.letter_date:
                delta = (rec.letter_date - rec.incident_date).days
                rec.incident_overdue = delta > 14
            else:
                rec.incident_overdue = False

    # -----------------------------------------------------------------
    # Onchange: auto-fill employee address
    # -----------------------------------------------------------------
    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            emp = self.employee_id
            self.employee_street = emp.private_street or ''
            self.employee_city = emp.private_city or ''
            self.employee_zip = emp.private_zip or ''
            self.company_id = emp.company_id

    # -----------------------------------------------------------------
    # Actions
    # -----------------------------------------------------------------
    def action_confirm(self):
        """Confirm termination, set departure on employee, generate PDF."""
        self.ensure_one()
        if not self.last_working_day:
            raise UserError(_('Last working day must be set before confirming.'))

        # Set departure on employee
        emp = self.employee_id
        departure_reason = self._get_departure_reason()
        emp.write({
            'departure_date': self.last_working_day,
            'departure_reason_id': departure_reason.id if departure_reason else False,
        })

        # Save employee address back to Odoo if it was entered
        if self.employee_street and not emp.private_street:
            emp.write({
                'private_street': self.employee_street,
                'private_city': self.employee_city,
                'private_zip': self.employee_zip,
            })

        # Generate PDF
        self._generate_pdf()

        self.write({'state': 'confirmed'})
        self.message_post(
            body=_('Termination confirmed. Departure date: %s') % self.last_working_day,
        )

    def action_cancel(self):
        self.ensure_one()
        # Clear departure from employee
        self.employee_id.write({
            'departure_date': False,
            'departure_reason_id': False,
        })
        self.write({'state': 'cancelled'})

    def action_archive_employee(self):
        """Archive the employee (set active=False)."""
        self.ensure_one()
        self.employee_id.write({'active': False})
        self.write({'state': 'archived'})
        self.message_post(body=_('Employee archived.'))

    def _get_departure_reason(self):
        """Map termination type to hr.departure.reason."""
        reason_map = {
            'ordentlich': 'Fired',
            'ordentlich_probezeit': 'Fired',
            'fristlos': 'Fired',
            'aufhebung': 'Fired',
            'bestaetigung': 'Resigned',
        }
        name = reason_map.get(self.termination_type, 'Fired')
        return self.env['hr.departure.reason'].search(
            [('name', '=', name)], limit=1,
        )

    # -----------------------------------------------------------------
    # PDF Generation
    # -----------------------------------------------------------------
    def _generate_pdf(self):
        """Generate the termination letter PDF using QWeb report."""
        self.ensure_one()
        report_map = {
            'ordentlich': 'krawings_termination.report_ordentliche_kuendigung',
            'ordentlich_probezeit': 'krawings_termination.report_ordentliche_kuendigung',
            'fristlos': 'krawings_termination.report_fristlose_kuendigung',
            'aufhebung': 'krawings_termination.report_aufhebungsvertrag',
            'bestaetigung': 'krawings_termination.report_kuendigungsbestaetigung',
        }
        report_name = report_map.get(self.termination_type)
        if not report_name:
            return

        pdf_content, _ = self.env['ir.actions.report']._render_qweb_pdf(
            report_name, self.ids,
        )

        filename = 'Kuendigung_%s_%s.pdf' % (
            self.employee_name.replace(' ', '_'),
            self.letter_date.strftime('%Y-%m-%d'),
        )

        import base64
        attachment = self.env['ir.attachment'].create({
            'name': filename,
            'type': 'binary',
            'datas': base64.b64encode(pdf_content),
            'res_model': self._name,
            'res_id': self.id,
            'mimetype': 'application/pdf',
        })
        self.pdf_attachment_id = attachment

    # -----------------------------------------------------------------
    # Send to Accountant
    # -----------------------------------------------------------------
    def action_send_to_accountant(self):
        """Email the PDF to the configured accountant."""
        self.ensure_one()
        if not self.pdf_attachment_id:
            raise UserError(_('No PDF generated yet. Please confirm the termination first.'))

        accountant_email = self.env['ir.config_parameter'].sudo().get_param(
            'krawings_termination.accountant_email', ''
        )
        if not accountant_email:
            raise UserError(_(
                'Accountant email not configured. '
                'Go to Settings > Termination to set it up.'
            ))

        subject_template = self.env['ir.config_parameter'].sudo().get_param(
            'krawings_termination.email_subject_template',
            'Kuendigung: {employee_name} - {company}'
        )
        type_labels = dict(TERMINATION_TYPES)
        subject = subject_template.format(
            employee_name=self.employee_name or '',
            company=self.company_id.name or '',
            type=type_labels.get(self.termination_type, ''),
            last_day=self.last_working_day.strftime('%d.%m.%Y') if self.last_working_day else '',
        )

        mail_values = {
            'subject': subject,
            'email_to': accountant_email,
            'body_html': '<p>Im Anhang finden Sie das Kuendigungsschreiben fuer %s.</p>' % (
                self.employee_name,
            ),
            'attachment_ids': [(4, self.pdf_attachment_id.id)],
        }
        mail = self.env['mail.mail'].sudo().create(mail_values)
        mail.send()

        self.write({
            'sent_to_accountant': True,
            'sent_to_accountant_date': fields.Datetime.now(),
        })
        self.message_post(
            body=_('Termination letter sent to accountant: %s') % accountant_email,
        )

    # -----------------------------------------------------------------
    # Odoo Sign Integration
    # -----------------------------------------------------------------
    def action_sign_and_send(self):
        """Create a sign.template from the PDF and send for signing."""
        self.ensure_one()
        if not self.pdf_attachment_id:
            raise UserError(_('No PDF generated yet. Please confirm the termination first.'))

        # Create sign template from the attachment
        sign_template = self.env['sign.template'].create({
            'attachment_id': self.pdf_attachment_id.id,
            'name': self.pdf_attachment_id.name,
        })

        # Get employee partner
        emp_partner = self.employee_id.work_contact_id or \
            self.employee_id.address_home_id
        if not emp_partner:
            raise UserError(_(
                'Employee has no contact partner linked. '
                'Please set a work contact or home address on the employee record.'
            ))

        # Get HR Responsible role and Employee role
        hr_role = self.env['sign.item.role'].search(
            [('name', '=', 'HR Responsible')], limit=1,
        )
        emp_role = self.env['sign.item.role'].search(
            [('name', '=', 'Employee')], limit=1,
        )
        if not hr_role or not emp_role:
            raise UserError(_('Sign roles "HR Responsible" and "Employee" must exist.'))

        # Create the sign request via wizard
        send_wizard = self.env['sign.send.request'].create({
            'template_id': sign_template.id,
            'signer_ids': [
                (0, 0, {
                    'role_id': hr_role.id,
                    'partner_id': self.env.user.partner_id.id,
                }),
                (0, 0, {
                    'role_id': emp_role.id,
                    'partner_id': emp_partner.id,
                }),
            ],
            'subject': 'Kuendigung - %s' % self.employee_name,
            'set_sign_order': True,
        })
        send_wizard.send_request()

        # Link the sign request
        sign_request = self.env['sign.request'].search([
            ('template_id', '=', sign_template.id),
        ], limit=1, order='id desc')

        self.write({
            'sign_request_id': sign_request.id if sign_request else False,
            'sign_state': 'employer_signed',
        })
        self.message_post(
            body=_('Sign request sent. Waiting for employee signature.'),
        )

        # Open Odoo Sign for the current user to sign first
        if sign_request:
            return {
                'type': 'ir.actions.act_url',
                'url': '/odoo/sign/%s' % sign_request.id,
                'target': 'self',
            }
