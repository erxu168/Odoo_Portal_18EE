from odoo import models, fields, api, _
from odoo.exceptions import UserError


class KwTerminationWizard(models.TransientModel):
    _name = 'kw.termination.wizard'
    _description = 'K\u00fcndigungsassistent'

    employee_id = fields.Many2one(
        'hr.employee', string='Mitarbeiter', required=True,
    )
    company_id = fields.Many2one(
        'res.company', string='Unternehmen',
        related='employee_id.company_id', readonly=True,
    )
    termination_type = fields.Selection(
        related=False,
        selection=[
            ('ordentlich', 'Ordentliche K\u00fcndigung'),
            ('ordentlich_probezeit', 'Ordentliche K\u00fcndigung (Probezeit)'),
            ('fristlos', 'Fristlose K\u00fcndigung'),
            ('aufhebung', 'Aufhebungsvertrag'),
            ('bestaetigung', 'K\u00fcndigungsbest\u00e4tigung'),
        ],
        string='Art', required=True, default='ordentlich',
    )
    calc_method = fields.Selection([
        ('bgb', '\u00a7 622 BGB gesetzlich (zum 15. / Monatsende)'),
        ('receipt', 'Ab Zugang (laufzeitabh\u00e4ngig ab Zustellung)'),
    ], string='Berechnungsmethode', default='bgb', required=True)

    letter_date = fields.Date(
        string='Datum des Schreibens', default=fields.Date.today, required=True,
    )
    receipt_date = fields.Date(string='Zugangsdatum')

    # Employee info (computed display)
    employee_start_date = fields.Date(
        string='Besch\u00e4ftigungsbeginn', compute='_compute_info',
    )
    tenure_display = fields.Char(
        string='Betriebszugeh\u00f6rigkeit', compute='_compute_info',
    )
    in_probation = fields.Boolean(
        string='In Probezeit', compute='_compute_info',
    )
    probation_end = fields.Date(
        string='Probezeit bis', compute='_compute_info',
    )
    notice_period_text = fields.Char(
        string='K\u00fcndigungsfrist', compute='_compute_info',
    )
    last_working_day = fields.Date(
        string='Letzter Arbeitstag', compute='_compute_info',
        readonly=False,
    )

    # Address
    employee_street = fields.Char(string='Stra\u00dfe')
    employee_city = fields.Char(string='Stadt')
    employee_zip = fields.Char(string='PLZ')
    address_missing = fields.Boolean(
        string='Adresse fehlt', compute='_compute_address_missing',
    )

    # Fristlose
    incident_date = fields.Date(string='Datum des Vorfalls')
    incident_description = fields.Text(string='Beschreibung (intern)')

    # Aufhebung
    agreed_end_date = fields.Date(string='Vereinbartes Enddatum')
    include_severance = fields.Boolean(string='Abfindung einschlie\u00dfen')
    severance_amount = fields.Float(string='Abfindungsbetrag')
    garden_leave = fields.Boolean(string='Freistellung')
    zeugnis_grade = fields.Selection([
        ('1', 'Sehr gut'), ('2', 'Gut'),
        ('3', 'Befriedigend'), ('4', 'Ausreichend'),
    ], string='Zeugnisnote', default='2')

    # Best\u00e4tigung
    resignation_received_date = fields.Date(string='K\u00fcndigung erhalten am')
    resignation_method = fields.Selection([
        ('letter', 'Brief'), ('email', 'E-Mail'), ('verbal', 'M\u00fcndlich'),
    ], string='Empfangsweg')
    written_resignation_received = fields.Boolean(string='Schriftliche K\u00fcndigung mit Unterschrift erhalten')

    @api.depends('employee_id', 'letter_date', 'termination_type',
                 'calc_method', 'receipt_date', 'resignation_received_date')
    def _compute_info(self):
        Termination = self.env['kw.termination']
        for wiz in self:
            if not wiz.employee_id:
                wiz.employee_start_date = False
                wiz.tenure_display = ''
                wiz.in_probation = False
                wiz.probation_end = False
                wiz.notice_period_text = ''
                wiz.last_working_day = False
                continue

            temp = Termination.new({
                'employee_id': wiz.employee_id.id,
                'letter_date': wiz.letter_date,
                'termination_type': wiz.termination_type,
                'calc_method': wiz.calc_method,
                'receipt_date': wiz.receipt_date,
                'resignation_received_date': wiz.resignation_received_date,
                'incident_date': wiz.incident_date,
            })
            temp._compute_employee_info()
            temp._compute_dates()

            wiz.employee_start_date = temp.employee_start_date
            wiz.in_probation = temp.in_probation
            wiz.probation_end = temp.probation_end
            wiz.notice_period_text = temp.notice_period_text
            wiz.last_working_day = temp.last_working_day

            years = int(temp.tenure_years)
            months = int((temp.tenure_years - years) * 12)
            wiz.tenure_display = '%d Jahre, %d Monate' % (years, months)

    @api.depends('employee_street')
    def _compute_address_missing(self):
        for wiz in self:
            wiz.address_missing = not bool(wiz.employee_street)

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            emp = self.employee_id
            self.employee_street = emp.private_street or ''
            self.employee_city = emp.private_city or ''
            self.employee_zip = emp.private_zip or ''

    def action_generate(self):
        """Create the kw.termination record and generate PDF."""
        self.ensure_one()

        vals = {
            'employee_id': self.employee_id.id,
            'company_id': self.employee_id.company_id.id,
            'termination_type': self.termination_type,
            'calc_method': self.calc_method,
            'letter_date': self.letter_date,
            'receipt_date': self.receipt_date,
            'employee_street': self.employee_street,
            'employee_city': self.employee_city,
            'employee_zip': self.employee_zip,
        }

        if self.termination_type == 'fristlos':
            vals.update({
                'incident_date': self.incident_date,
                'incident_description': self.incident_description,
            })
        elif self.termination_type == 'aufhebung':
            vals.update({
                'last_working_day': self.agreed_end_date,
                'include_severance': self.include_severance,
                'severance_amount': self.severance_amount,
                'garden_leave': self.garden_leave,
                'zeugnis_grade': self.zeugnis_grade,
            })
        elif self.termination_type == 'bestaetigung':
            vals.update({
                'resignation_received_date': self.resignation_received_date,
                'resignation_method': self.resignation_method,
                'written_resignation_received': self.written_resignation_received,
            })

        termination = self.env['kw.termination'].create(vals)
        termination.action_confirm()

        return {
            'type': 'ir.actions.act_window',
            'res_model': 'kw.termination',
            'res_id': termination.id,
            'view_mode': 'form',
            'target': 'current',
        }
