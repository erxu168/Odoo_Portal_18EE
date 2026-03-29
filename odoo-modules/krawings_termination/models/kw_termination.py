from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
from dateutil.relativedelta import relativedelta
from datetime import date, timedelta
import logging

_logger = logging.getLogger(__name__)

BGB_622_PERIODS = [
    (20, 7, '7 Monate zum Monatsende', '7 months to end of month'),
    (15, 6, '6 Monate zum Monatsende', '6 months to end of month'),
    (12, 5, '5 Monate zum Monatsende', '5 months to end of month'),
    (10, 4, '4 Monate zum Monatsende', '4 months to end of month'),
    (8, 3, '3 Monate zum Monatsende', '3 months to end of month'),
    (5, 2, '2 Monate zum Monatsende', '2 months to end of month'),
    (2, 1, '1 Monat zum Monatsende', '1 month to end of month'),
]

TERMINATION_TYPES = [
    ('ordentlich', 'Ordentliche K\u00fcndigung'),
    ('ordentlich_probezeit', 'Ordentliche K\u00fcndigung (Probezeit)'),
    ('fristlos', 'Fristlose K\u00fcndigung'),
    ('aufhebung', 'Aufhebungsvertrag'),
    ('bestaetigung', 'K\u00fcndigungsbest\u00e4tigung'),
]

CALC_METHODS = [
    ('bgb', '\u00a7 622 BGB gesetzlich (zum 15. / Monatsende)'),
    ('receipt', 'Ab Zugang (laufzeitabh\u00e4ngig ab Zustellung)'),
]

TERMINATION_STATES = [
    ('draft', 'Entwurf'),
    ('confirmed', 'Best\u00e4tigt'),
    ('signed', 'Unterschrieben'),
    ('delivered', 'Zugestellt'),
    ('archived', 'Archiviert'),
    ('cancelled', 'Storniert'),
]

DELIVERY_METHODS = [
    ('einschreiben_rueckschein', 'Einschreiben mit R\u00fcckschein'),
    ('einwurf_einschreiben', 'Einwurf-Einschreiben'),
    ('personal', 'Pers\u00f6nliche \u00dcbergabe'),
    ('bote', 'Bote (mit Zeuge)'),
]


class KwTermination(models.Model):
    _name = 'kw.termination'
    _description = 'Employee Termination Record'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'letter_date desc, id desc'
    _rec_name = 'display_name'

    # --- Core fields ---
    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True,
        tracking=True, ondelete='restrict',
    )
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company, tracking=True,
    )
    termination_type = fields.Selection(
        TERMINATION_TYPES, string='Type', required=True, tracking=True,
    )
    calc_method = fields.Selection(
        CALC_METHODS, string='Berechnungsmethode',
        default='bgb', required=True, tracking=True,
    )
    state = fields.Selection(
        TERMINATION_STATES, string='Status',
        default='draft', required=True, tracking=True,
    )

    # --- Dates ---
    letter_date = fields.Date(
        string='Datum des Schreibens', default=fields.Date.today,
        required=True, tracking=True,
    )
    receipt_date = fields.Date(
        string='Zugangsdatum',
        help='Datum, an dem der Arbeitnehmer das Schreiben erhalten hat',
    )
    notice_period_text = fields.Char(
        string='K\u00fcndigungsfrist', compute='_compute_dates', store=True,
    )
    last_working_day = fields.Date(
        string='Letzter Arbeitstag', compute='_compute_dates',
        store=True, readonly=False, tracking=True,
    )
    departure_date = fields.Date(
        string='Austrittsdatum', related='last_working_day',
        store=True, readonly=True,
    )

    # --- Employee info ---
    employee_name = fields.Char(
        related='employee_id.name', store=True, string='Mitarbeitername',
    )
    employee_street = fields.Char(string='Stra\u00dfe')
    employee_city = fields.Char(string='Stadt')
    employee_zip = fields.Char(string='PLZ')
    employee_start_date = fields.Date(
        string='Besch\u00e4ftigungsbeginn', compute='_compute_employee_info', store=True,
    )
    tenure_years = fields.Float(
        string='Betriebszugeh\u00f6rigkeit (Jahre)', compute='_compute_employee_info', store=True,
    )
    in_probation = fields.Boolean(
        string='In Probezeit', compute='_compute_employee_info', store=True,
    )
    probation_end = fields.Date(
        string='Probezeit bis', compute='_compute_employee_info', store=True,
    )

    # --- Fristlose fields ---
    incident_date = fields.Date(string='Datum des Vorfalls')
    incident_description = fields.Text(string='Beschreibung des Vorfalls (intern)')
    incident_overdue = fields.Boolean(
        string='14-Tage-Frist \u00fcberschritten',
        compute='_compute_incident_overdue', store=True,
    )

    # --- Aufhebung fields ---
    include_severance = fields.Boolean(string='Abfindung einschlie\u00dfen')
    severance_amount = fields.Float(string='Abfindungsbetrag')
    garden_leave = fields.Boolean(string='Freistellung')
    zeugnis_grade = fields.Selection([
        ('1', 'Sehr gut'), ('2', 'Gut'),
        ('3', 'Befriedigend'), ('4', 'Ausreichend'),
    ], string='Zeugnisnote', default='2')

    # --- Bestaetigung fields ---
    resignation_received_date = fields.Date(string='K\u00fcndigung erhalten am')
    resignation_method = fields.Selection([
        ('letter', 'Brief'), ('email', 'E-Mail'), ('verbal', 'M\u00fcndlich'),
    ], string='Empfangsweg')
    written_resignation_received = fields.Boolean(
        string='Schriftliche K\u00fcndigung mit Unterschrift erhalten',
    )

    # --- PDF + Signature ---
    pdf_attachment_id = fields.Many2one('ir.attachment', string='Generiertes PDF')
    signed_pdf_attachment_id = fields.Many2one('ir.attachment', string='Unterschriebenes PDF')
    sign_request_id = fields.Many2one('sign.request', string='Signaturanfrage')

    # --- Delivery tracking (Zustellung) ---
    delivery_method = fields.Selection(
        DELIVERY_METHODS, string='Zustellungsart', tracking=True,
    )
    delivery_date = fields.Date(
        string='Versanddatum / Zustelldatum', tracking=True,
        help='Datum, an dem der Brief versandt oder pers\u00f6nlich \u00fcbergeben wurde',
    )
    delivery_tracking_number = fields.Char(
        string='Sendungsnummer',
        help='Sendungsverfolgungsnummer (Einschreiben)',
    )
    delivery_witness = fields.Char(
        string='Zeuge',
        help='Name des Zeugen bei pers\u00f6nlicher \u00dcbergabe oder Bote',
    )
    delivery_confirmed = fields.Boolean(
        string='Zustellung best\u00e4tigt', tracking=True,
        help='R\u00fcckschein erhalten oder Zustellung anderweitig best\u00e4tigt',
    )
    delivery_confirmed_date = fields.Date(
        string='Zustellung best\u00e4tigt am', tracking=True,
    )
    delivery_notes = fields.Text(
        string='Anmerkungen zur Zustellung',
    )
    delivery_proof_attachment_id = fields.Many2one(
        'ir.attachment', string='Zustellnachweis',
        help='R\u00fcckschein, Foto, Scan des Empfangsscheins o.\u00e4.',
    )

    # --- Employee Empfangsbestaetigung (optional) ---
    empfang_received = fields.Boolean(
        string='Empfangsbest\u00e4tigung erhalten', tracking=True,
        help='Arbeitnehmer hat den Erhalt der K\u00fcndigung best\u00e4tigt (optional)',
    )
    empfang_date = fields.Date(string='Empfangsbest\u00e4tigung am')
    empfang_attachment_id = fields.Many2one(
        'ir.attachment', string='Unterschriebene Empfangsbest\u00e4tigung',
    )

    # --- Accountant ---
    sent_to_accountant = fields.Boolean(string='An Steuerberater gesendet')
    sent_to_accountant_date = fields.Datetime(string='Gesendet am')

    display_name = fields.Char(compute='_compute_display_name', store=True)

    # =================================================================
    # Computed fields
    # =================================================================
    @api.depends('employee_name', 'termination_type', 'letter_date')
    def _compute_display_name(self):
        type_labels = dict(TERMINATION_TYPES)
        for rec in self:
            parts = [rec.employee_name or 'Neu']
            if rec.termination_type:
                parts.append(type_labels.get(rec.termination_type, ''))
            if rec.letter_date:
                parts.append(str(rec.letter_date))
            rec.display_name = ' - '.join(parts)

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

            contract = self.env['hr.contract'].search([
                ('employee_id', '=', emp.id),
                ('state', '=', 'open'),
            ], limit=1, order='date_start asc')
            start = contract.date_start if contract else False
            if not start and hasattr(emp, 'kw_beschaeftigungsbeginn'):
                start = emp.kw_beschaeftigungsbeginn
            rec.employee_start_date = start

            ref_date = rec.letter_date or date.today()
            if start:
                delta = relativedelta(ref_date, start)
                rec.tenure_years = delta.years + (delta.months / 12.0)
            else:
                rec.tenure_years = 0

            prob_end = False
            if hasattr(emp, 'kw_probezeit_bis') and emp.kw_probezeit_bis:
                prob_end = emp.kw_probezeit_bis
            elif contract and contract.trial_date_end:
                prob_end = contract.trial_date_end
            rec.probation_end = prob_end
            rec.in_probation = bool(prob_end and ref_date <= prob_end)

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
            elif rec.termination_type == 'bestaetigung':
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
        if rec.calc_method == 'receipt' and rec.receipt_date:
            base = rec.receipt_date
        else:
            base = rec.letter_date
        lwd = base + timedelta(days=14)
        return ('2 Wochen (Probezeit)', lwd)

    def _calc_standard_notice(self, rec):
        tenure = rec.tenure_years or 0
        months = 0
        desc_de = '4 Wochen zum 15. oder Monatsende'
        is_base = True

        for min_years, period_months, de, en in BGB_622_PERIODS:
            if tenure >= min_years:
                months = period_months
                desc_de = de
                is_base = False
                break

        if rec.calc_method == 'receipt' and rec.receipt_date:
            base = rec.receipt_date
            if is_base:
                lwd = base + timedelta(days=28)
            else:
                lwd = base + relativedelta(months=months)
            return (desc_de, lwd)
        else:
            base = rec.letter_date
            if is_base:
                earliest = base + timedelta(days=28)
                lwd = self._snap_to_15th_or_end(earliest)
            else:
                earliest = base + relativedelta(months=months)
                lwd = self._snap_to_month_end(earliest)
            return (desc_de, lwd)

    @staticmethod
    def _calc_employee_notice(ref_date):
        earliest = ref_date + timedelta(days=28)
        lwd = KwTermination._snap_to_15th_or_end(earliest)
        return ('4 Wochen zum 15. oder Monatsende', lwd)

    @staticmethod
    def _snap_to_15th_or_end(d):
        import calendar
        fifteenth = d.replace(day=15)
        if fifteenth >= d:
            return fifteenth
        last_day = calendar.monthrange(d.year, d.month)[1]
        end_of_month = d.replace(day=last_day)
        if end_of_month >= d:
            return end_of_month
        next_month = d + relativedelta(months=1)
        return next_month.replace(day=15)

    @staticmethod
    def _snap_to_month_end(d):
        import calendar
        last_day = calendar.monthrange(d.year, d.month)[1]
        end_of_month = d.replace(day=last_day)
        if end_of_month >= d:
            return end_of_month
        next_month = d + relativedelta(months=1)
        last_day = calendar.monthrange(next_month.year, next_month.month)[1]
        return next_month.replace(day=last_day)

    @api.depends('incident_date', 'letter_date')
    def _compute_incident_overdue(self):
        for rec in self:
            if rec.incident_date and rec.letter_date:
                rec.incident_overdue = (rec.letter_date - rec.incident_date).days > 14
            else:
                rec.incident_overdue = False

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            emp = self.employee_id
            self.employee_street = emp.private_street or ''
            self.employee_city = emp.private_city or ''
            self.employee_zip = emp.private_zip or ''
            self.company_id = emp.company_id

    # =================================================================
    # Actions
    # =================================================================
    def action_confirm(self):
        self.ensure_one()
        if not self.last_working_day:
            raise UserError(_('Letzter Arbeitstag muss vor der Best\u00e4tigung gesetzt werden.'))

        emp = self.employee_id
        departure_reason = self._get_departure_reason()
        emp.write({
            'departure_date': self.last_working_day,
            'departure_reason_id': departure_reason.id if departure_reason else False,
        })

        if self.employee_street and not emp.private_street:
            emp.write({
                'private_street': self.employee_street,
                'private_city': self.employee_city,
                'private_zip': self.employee_zip,
            })

        self._generate_pdf()
        self.write({'state': 'confirmed'})
        self.message_post(
            body=_('K\u00fcndigung best\u00e4tigt. Austrittsdatum: %s') % self.last_working_day,
        )

    def action_cancel(self):
        self.ensure_one()
        self.employee_id.write({
            'departure_date': False,
            'departure_reason_id': False,
        })
        self.write({'state': 'cancelled'})

    def action_mark_delivered(self):
        """Mark the termination letter as delivered to the employee."""
        self.ensure_one()
        if not self.delivery_method:
            raise UserError(_('Bitte w\u00e4hlen Sie die Zustellungsart aus.'))
        if not self.delivery_date:
            raise UserError(_('Bitte geben Sie das Zustelldatum ein.'))

        # For personal handover or Bote, require a witness
        if self.delivery_method in ('personal', 'bote') and not self.delivery_witness:
            raise UserError(_('Bei pers\u00f6nlicher \u00dcbergabe oder Bote ist ein Zeuge erforderlich.'))

        self.write({'state': 'delivered'})
        method_labels = dict(DELIVERY_METHODS)
        msg = _('K\u00fcndigung zugestellt am %s per %s.') % (
            self.delivery_date.strftime('%d.%m.%Y'),
            method_labels.get(self.delivery_method, ''),
        )
        if self.delivery_tracking_number:
            msg += _(' Sendungsnr.: %s') % self.delivery_tracking_number
        if self.delivery_witness:
            msg += _(' Zeuge: %s') % self.delivery_witness
        self.message_post(body=msg)

    def action_confirm_delivery_received(self):
        """Mark that delivery confirmation was received (Rueckschein etc.)."""
        self.ensure_one()
        self.write({
            'delivery_confirmed': True,
            'delivery_confirmed_date': fields.Date.today(),
        })
        self.message_post(
            body=_('Zustellungsbest\u00e4tigung erhalten am %s.') % fields.Date.today().strftime('%d.%m.%Y'),
        )

    def action_archive_employee(self):
        self.ensure_one()
        self.employee_id.write({'active': False})
        self.write({'state': 'archived'})
        self.message_post(body=_('Mitarbeiter archiviert.'))

    def _get_departure_reason(self):
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

    # =================================================================
    # PDF generation
    # =================================================================
    def _generate_pdf(self):
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

    # =================================================================
    # Send to accountant
    # =================================================================
    def action_send_to_accountant(self):
        self.ensure_one()
        if not self.pdf_attachment_id:
            raise UserError(_('Noch kein PDF erstellt. Bitte zuerst die K\u00fcndigung best\u00e4tigen.'))

        accountant_email = self.env['ir.config_parameter'].sudo().get_param(
            'krawings_termination.accountant_email', ''
        )
        if not accountant_email:
            raise UserError(_('Steuerberater-E-Mail nicht konfiguriert.'))

        subject_template = self.env['ir.config_parameter'].sudo().get_param(
            'krawings_termination.email_subject_template',
            'K\u00fcndigung: {employee_name} - {company}'
        )
        type_labels = dict(TERMINATION_TYPES)
        subject = subject_template.format(
            employee_name=self.employee_name or '',
            company=self.company_id.name or '',
            type=type_labels.get(self.termination_type, ''),
            last_day=self.last_working_day.strftime('%d.%m.%Y') if self.last_working_day else '',
        )

        mail = self.env['mail.mail'].sudo().create({
            'subject': subject,
            'email_to': accountant_email,
            'body_html': '<p>Im Anhang finden Sie das K\u00fcndigungsschreiben f\u00fcr %s.</p>' % self.employee_name,
            'attachment_ids': [(4, self.pdf_attachment_id.id)],
        })
        mail.send()

        self.write({
            'sent_to_accountant': True,
            'sent_to_accountant_date': fields.Datetime.now(),
        })
        self.message_post(
            body=_('K\u00fcndigungsschreiben an Steuerberater gesendet: %s') % accountant_email,
        )

    # =================================================================
    # Odoo Sign - employer signature only
    # =================================================================
    def _get_sign_item_positions(self):
        """Return sign item positions for EMPLOYER ONLY.
        Employee does not sign digitally - letter is delivered physically.
        """
        if self.termination_type == 'aufhebung':
            # Aufhebungsvertrag: employer signature left
            return [
                {'type': 'signature',
                 'page': 1, 'posX': 0.05, 'posY': 0.82, 'width': 0.22, 'height': 0.05},
                {'type': 'date',
                 'page': 1, 'posX': 0.05, 'posY': 0.88, 'width': 0.15, 'height': 0.02},
            ]
        else:
            # Ordentliche/Fristlose/Bestaetigung: employer signature above Geschaeftsfuehrung
            return [
                {'type': 'signature',
                 'page': 1, 'posX': 0.05, 'posY': 0.62, 'width': 0.22, 'height': 0.05},
            ]

    def action_sign(self):
        """Create a sign.template for EMPLOYER ONLY and open Odoo Sign.
        After employer signs -> state becomes 'signed', signed PDF stored.
        """
        self.ensure_one()
        if not self.pdf_attachment_id:
            raise UserError(_('Noch kein PDF erstellt. Bitte zuerst die K\u00fcndigung best\u00e4tigen.'))

        sign_template = self.env['sign.template'].create({
            'attachment_id': self.pdf_attachment_id.id,
            'name': self.pdf_attachment_id.name,
        })

        # Get HR role for employer
        hr_role = self.env['sign.item.role'].search(
            [('name', '=', 'HR Responsible')], limit=1,
        )
        if not hr_role:
            hr_role = self.env['sign.item.role'].search([], limit=1)

        sig_type = self.env['sign.item.type'].search([('item_type', '=', 'signature')], limit=1)
        date_type = self.env['sign.item.type'].search([('name', '=', 'Date')], limit=1)
        if not sig_type:
            raise UserError(_('Sign-Typ "Signature" nicht gefunden.'))
        if not date_type:
            date_type = self.env['sign.item.type'].search([('name', '=', 'Text')], limit=1)

        type_map = {'signature': sig_type.id, 'date': date_type.id}

        positions = self._get_sign_item_positions()
        for pos in positions:
            self.env['sign.item'].create({
                'template_id': sign_template.id,
                'type_id': type_map[pos['type']],
                'responsible_id': hr_role.id,
                'required': True,
                'page': pos['page'],
                'posX': pos['posX'],
                'posY': pos['posY'],
                'width': pos['width'],
                'height': pos['height'],
            })

        sign_filename = self.pdf_attachment_id.name or 'Kuendigung_%s.pdf' % (
            self.employee_name.replace(' ', '_'),
        )

        # Single signer: employer only
        send_wizard = self.env['sign.send.request'].create({
            'template_id': sign_template.id,
            'filename': sign_filename,
            'signer_id': self.env.user.partner_id.id,
            'signer_ids': [
                (0, 0, {
                    'role_id': hr_role.id,
                    'partner_id': self.env.user.partner_id.id,
                    'mail_sent_order': 1,
                }),
            ],
            'subject': 'K\u00fcndigung - %s' % self.employee_name,
        })
        send_wizard.send_request()

        sign_request = self.env['sign.request'].search([
            ('template_id', '=', sign_template.id),
        ], limit=1, order='id desc')

        self.write({
            'sign_request_id': sign_request.id if sign_request else False,
        })
        self.message_post(
            body=_('Signaturanfrage erstellt. Bitte unterschreiben.'),
        )

        if sign_request:
            return {
                'type': 'ir.actions.act_url',
                'url': '/odoo/sign/%s' % sign_request.id,
                'target': 'self',
            }

    def action_check_sign_status(self):
        """Check if employer has signed and process the signed document."""
        self.ensure_one()
        if not self.sign_request_id:
            raise UserError(_('Keine Signaturanfrage vorhanden.'))

        if self.sign_request_id.state == 'signed':
            self._process_signed_document()
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Unterschrift abgeschlossen'),
                    'message': _('Das unterschriebene Dokument wurde gespeichert. Sie k\u00f6nnen es jetzt ausdrucken und versenden.'),
                    'type': 'success',
                    'sticky': False,
                },
            }
        else:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Signaturstatus'),
                    'message': _('Unterschrift steht noch aus.'),
                    'type': 'warning',
                    'sticky': False,
                },
            }

    def _process_signed_document(self):
        """Process employer-signed document:
        1. Copy signed PDF to kw.termination
        2. Store in Odoo Documents app
        3. Post to chatter
        4. Set state to 'signed'
        """
        self.ensure_one()
        sign_req = self.sign_request_id
        if not sign_req or sign_req.state != 'signed':
            return

        if self.state == 'signed':
            _logger.info('Termination %s already in signed state', self.id)
            return

        signed_attachments = sign_req.completed_document_attachment_ids
        if not signed_attachments:
            _logger.warning('No completed document for sign request %s', sign_req.id)
            return

        signed_att = signed_attachments[0]

        signed_filename = 'Kuendigung_%s_%s_UNTERSCHRIEBEN.pdf' % (
            self.employee_name.replace(' ', '_'),
            self.letter_date.strftime('%Y-%m-%d'),
        )
        new_attachment = signed_att.copy({
            'name': signed_filename,
            'res_model': self._name,
            'res_id': self.id,
        })

        self.write({
            'signed_pdf_attachment_id': new_attachment.id,
            'pdf_attachment_id': new_attachment.id,
            'state': 'signed',
        })

        # Store in Odoo Documents app
        try:
            if self.env['ir.module.module'].sudo().search([
                ('name', '=', 'documents'), ('state', '=', 'installed')
            ]):
                folder = self.env['documents.folder'].sudo().search(
                    [('name', '=', 'Terminations')], limit=1
                )
                if not folder:
                    folder = self.env['documents.folder'].sudo().create({
                        'name': 'Terminations',
                    })
                facet = self.env['documents.facet'].sudo().search(
                    [('name', '=', 'Document Type')], limit=1
                )
                tag = self.env['documents.tag'].sudo().search(
                    [('name', '=', 'Signed Termination')], limit=1
                )
                if not tag and facet:
                    tag = self.env['documents.tag'].sudo().create({
                        'name': 'Signed Termination',
                        'facet_id': facet.id,
                    })
                doc_vals = {
                    'name': signed_filename,
                    'folder_id': folder.id,
                    'attachment_id': new_attachment.id,
                    'partner_id': self.employee_id.work_contact_id.id if self.employee_id.work_contact_id else False,
                    'res_model': self._name,
                    'res_id': self.id,
                }
                if tag:
                    doc_vals['tag_ids'] = [(4, tag.id)]
                self.env['documents.document'].sudo().create(doc_vals)
        except Exception as e:
            _logger.warning('Could not store in Documents app: %s', e)

        # Post to chatter
        self.message_post(
            body=_('K\u00fcndigung unterschrieben. Bitte ausdrucken und per Post versenden.'),
            attachment_ids=[new_attachment.id],
        )

    @api.model
    def _cron_check_sign_completion(self):
        """Cron: check pending sign requests and process completed ones."""
        pending = self.search([
            ('state', '=', 'confirmed'),
            ('sign_request_id', '!=', False),
        ])
        for rec in pending:
            try:
                if rec.sign_request_id.state == 'signed':
                    rec._process_signed_document()
            except Exception as e:
                _logger.error('Cron: error processing termination %s: %s', rec.id, e)
