from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError
from dateutil.relativedelta import relativedelta
from datetime import date, timedelta
import calendar
import logging

_logger = logging.getLogger(__name__)

# -------------------------------------------------------------------
# Section 622 BGB - Statutory notice periods (employer -> employee)
# German text goes INTO the legal letters (do not translate); the English
# text is the UI mirror shown in Odoo and the portal.
# -------------------------------------------------------------------
BGB_622_PERIODS = [
    # (min_years, months_notice, german_label, english_label)
    (20, 7, '7 Monate zum Monatsende', '7 months to month-end'),
    (15, 6, '6 Monate zum Monatsende', '6 months to month-end'),
    (12, 5, '5 Monate zum Monatsende', '5 months to month-end'),
    (10, 4, '4 Monate zum Monatsende', '4 months to month-end'),
    (8, 3, '3 Monate zum Monatsende', '3 months to month-end'),
    (5, 2, '2 Monate zum Monatsende', '2 months to month-end'),
    (2, 1, '1 Monat zum Monatsende', '1 month to month-end'),
]

FOUR_WEEKS_DE = '4 Wochen zum 15. oder Monatsende'
FOUR_WEEKS_EN = '4 weeks to the 15th or month-end'

# Fields that are baked into the generated German letter. Changing one of them
# after the letter exists marks the stored PDF as outdated.
LETTER_FIELDS = {
    'termination_type', 'letter_date', 'calc_method', 'receipt_date',
    'include_severance', 'severance_amount', 'garden_leave',
    'resignation_received_date', 'incident_date',
    'employee_street', 'employee_city', 'employee_zip', 'last_working_day',
}

# Allowed state transitions (validated on every write).
ALLOWED_TRANSITIONS = {
    'draft': {'confirmed', 'cancelled'},
    'confirmed': {'signed', 'cancelled'},
    # signed -> delivered stays allowed for the portal-compat window and for
    # personal handover, where dispatch and receipt happen in one step.
    'signed': {'in_transit', 'delivered', 'cancelled'},  # delivered only survives the
    # delivered-invariant constraint when confirmation fields are written with it
    'in_transit': {'delivered', 'cancelled'},
    'delivered': {'archived'},
    'archived': set(),
    'cancelled': set(),
}


class KwTermination(models.Model):
    _name = 'kw.termination'
    _description = 'Employee Termination Record'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'letter_date desc, id desc'
    _rec_name = 'display_name'

    # --- Core ---
    employee_id = fields.Many2one(
        'hr.employee', string='Employee', required=True,
        tracking=True, ondelete='restrict',
    )
    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company, tracking=True,
    )
    termination_type = fields.Selection([
        ('ordentlich', 'Standard termination (Ordentliche Kündigung)'),
        ('ordentlich_probezeit', 'Probation termination (Probezeit)'),
        ('fristlos', 'Immediate termination (Fristlos)'),
        ('aufhebung', 'Mutual agreement (Aufhebungsvertrag)'),
        ('bestaetigung', 'Resignation acknowledgment'),
    ], string='Type', required=True, tracking=True)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('signed', 'Signed'),
        ('in_transit', 'In Transit'),
        ('delivered', 'Delivered'),
        ('archived', 'Archived'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='draft', required=True, tracking=True)

    # --- Dates & notice period ---
    letter_date = fields.Date(
        string='Letter date', default=fields.Date.today,
        required=True, tracking=True,
    )
    receipt_date = fields.Date(
        string='Receipt date',
        help='Date the employee received the letter',
        tracking=True,
    )
    calc_method = fields.Selection([
        ('bgb', '§ 622 BGB statutory'),
        ('receipt', 'From receipt date'),
    ], string='Calculation method', default='bgb', required=True)
    notice_period_text = fields.Char(
        string='Notice period (German, used in the letter)',
        compute='_compute_dates', store=True,
    )
    notice_period_text_en = fields.Char(
        string='Notice period', compute='_compute_dates', store=True,
    )
    last_working_day = fields.Date(
        string='Last working day', compute='_compute_dates',
        store=True, readonly=False, tracking=True,
    )

    # --- Employee info (snapshot) ---
    employee_name = fields.Char(
        related='employee_id.name', store=True, string='Name',
    )
    employee_street = fields.Char(string='Street')
    employee_city = fields.Char(string='City')
    employee_zip = fields.Char(string='Postcode')
    employee_start_date = fields.Date(
        string='Employment start', compute='_compute_employee_info', store=True,
    )
    tenure_years = fields.Float(
        string='Tenure (years)',
        compute='_compute_employee_info', store=True,
    )
    in_probation = fields.Boolean(
        string='In probation', compute='_compute_employee_info', store=True,
    )
    probation_end = fields.Date(
        string='Probation until', compute='_compute_employee_info', store=True,
    )

    # --- Fristlose ---
    incident_date = fields.Date(string='Incident date')
    incident_description = fields.Text(string='Description (internal)')

    # --- Aufhebungsvertrag ---
    include_severance = fields.Boolean(string='Severance')
    severance_amount = fields.Float(string='Severance amount (EUR)')
    garden_leave = fields.Boolean(string='Garden leave')

    # --- Bestaetigung ---
    resignation_received_date = fields.Date(string='Resignation received on')

    # --- PDF + Signature (managed by portal, stored here) ---
    pdf_attachment_id = fields.Many2one(
        'ir.attachment', string='Generated PDF',
        help='Generated by the portal',
    )
    signed_pdf_attachment_id = fields.Many2one(
        'ir.attachment', string='Signed PDF',
    )
    pdf_outdated = fields.Boolean(
        string='Letter may be outdated',
        help='A letter-relevant field changed after the PDF was generated.',
    )

    # --- Delivery tracking ---
    delivery_method = fields.Selection([
        ('einschreiben_rueckschein', 'Registered mail, return receipt (Einschreiben mit Rückschein)'),
        ('einwurf_einschreiben', 'Registered mail, mailbox (Einwurf-Einschreiben)'),
        ('personal', 'Personal handover'),
        ('bote', 'Courier with witness'),
    ], string='Delivery method', tracking=True)
    delivery_date = fields.Date(string='Sent on', tracking=True)
    delivery_tracking_number = fields.Char(string='Tracking number')
    delivery_witness = fields.Char(string='Witness')
    delivery_confirmed = fields.Boolean(string='Delivery confirmed', tracking=True)
    delivery_confirmed_date = fields.Date(string='Confirmed on', tracking=True)
    delivery_proof_attachment_id = fields.Many2one(
        'ir.attachment', string='Proof of delivery',
    )
    delivery_notes = fields.Text(string='Notes')

    # --- Accountant ---
    sent_to_accountant = fields.Boolean(string='Sent to accountant')
    sent_to_accountant_date = fields.Datetime(string='Sent on (accountant)')

    display_name = fields.Char(compute='_compute_display_name', store=True)

    # =================================================================
    # Computed fields
    # =================================================================
    @api.depends('employee_name', 'termination_type', 'letter_date')
    def _compute_display_name(self):
        labels = dict(self._fields['termination_type'].selection)
        for rec in self:
            parts = [rec.employee_name or 'New']
            if rec.termination_type:
                parts.append(labels.get(rec.termination_type, ''))
            if rec.letter_date:
                parts.append(str(rec.letter_date))
            rec.display_name = ' – '.join(parts)

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
            rec.employee_start_date = start

            ref = rec.letter_date or date.today()
            if start:
                d = relativedelta(ref, start)
                rec.tenure_years = round(d.years + d.months / 12.0, 1)
            else:
                rec.tenure_years = 0

            prob_end = contract.trial_date_end if contract else False
            rec.probation_end = prob_end
            rec.in_probation = bool(prob_end and ref <= prob_end)

    @api.depends(
        'termination_type', 'calc_method', 'letter_date', 'receipt_date',
        'employee_start_date', 'tenure_years', 'in_probation',
        'resignation_received_date',
    )
    def _compute_dates(self):
        for rec in self:
            if not rec.termination_type or not rec.letter_date:
                rec.notice_period_text = ''
                rec.notice_period_text_en = ''
                rec.last_working_day = False
                continue

            ttype = rec.termination_type
            if ttype == 'fristlos':
                rec.notice_period_text = 'Sofort (fristlos)'
                rec.notice_period_text_en = 'Immediate (without notice)'
                rec.last_working_day = rec.letter_date

            elif ttype == 'aufhebung':
                rec.notice_period_text = 'Einvernehmlich'
                rec.notice_period_text_en = 'Mutual agreement'
                # last_working_day set manually

            elif ttype == 'bestaetigung':
                ref = rec.resignation_received_date or rec.letter_date
                rec.notice_period_text = FOUR_WEEKS_DE
                rec.notice_period_text_en = FOUR_WEEKS_EN
                rec.last_working_day = self._snap_15_or_end(ref + timedelta(days=28))

            elif ttype in ('ordentlich', 'ordentlich_probezeit'):
                if rec.in_probation or ttype == 'ordentlich_probezeit':
                    base = (rec.receipt_date if rec.calc_method == 'receipt' and rec.receipt_date
                            else rec.letter_date)
                    rec.notice_period_text = '2 Wochen (Probezeit)'
                    rec.notice_period_text_en = '2 weeks (probation)'
                    rec.last_working_day = base + timedelta(days=14)
                else:
                    de, en, day = self._calc_bgb622(rec)
                    rec.notice_period_text = de
                    rec.notice_period_text_en = en
                    rec.last_working_day = day

    def _calc_bgb622(self, rec):
        """Calculate notice period per Par. 622 BGB. Returns (de, en, last_day)."""
        tenure = rec.tenure_years or 0
        base = (rec.receipt_date if rec.calc_method == 'receipt' and rec.receipt_date
                else rec.letter_date)

        for min_years, months, label_de, label_en in BGB_622_PERIODS:
            if tenure >= min_years:
                earliest = base + relativedelta(months=months)
                return (label_de, label_en, self._snap_month_end(earliest))

        earliest = base + timedelta(days=28)
        return (FOUR_WEEKS_DE, FOUR_WEEKS_EN, self._snap_15_or_end(earliest))

    @staticmethod
    def _snap_15_or_end(d):
        """Snap date to next 15th or end-of-month."""
        fif = d.replace(day=15)
        if fif >= d:
            return fif
        last = calendar.monthrange(d.year, d.month)[1]
        eom = d.replace(day=last)
        if eom >= d:
            return eom
        nxt = d + relativedelta(months=1)
        return nxt.replace(day=15)

    @staticmethod
    def _snap_month_end(d):
        """Snap date to end of month."""
        last = calendar.monthrange(d.year, d.month)[1]
        eom = d.replace(day=last)
        if eom >= d:
            return eom
        nxt = d + relativedelta(months=1)
        last = calendar.monthrange(nxt.year, nxt.month)[1]
        return nxt.replace(day=last)

    # =================================================================
    # Guards
    # =================================================================
    @api.constrains('state', 'delivery_method', 'delivery_date',
                    'delivery_confirmed', 'delivery_confirmed_date')
    def _check_state_invariants(self):
        for rec in self:
            if rec.state == 'in_transit' and (not rec.delivery_method or not rec.delivery_date):
                raise ValidationError(_('A sent letter needs a delivery method and sent date.'))
            if rec.state == 'delivered' and (not rec.delivery_confirmed or not rec.delivery_confirmed_date):
                raise ValidationError(_('A delivered letter needs a confirmed delivery (with date).'))

    @api.constrains('delivery_date', 'receipt_date', 'delivery_confirmed_date')
    def _check_delivery_dates(self):
        for rec in self:
            if rec.delivery_date and rec.receipt_date and rec.receipt_date < rec.delivery_date:
                raise ValidationError(_('Receipt date cannot be before the sent date.'))
            if rec.delivery_date and rec.delivery_confirmed_date and rec.delivery_confirmed_date < rec.delivery_date:
                raise ValidationError(_('Confirmation date cannot be before the sent date.'))

    def write(self, vals):
        # Validate state transitions (portal writes state directly during the
        # compat window; actions below use the same path).
        if 'state' in vals:
            for rec in self:
                new = vals['state']
                if new != rec.state and new not in ALLOWED_TRANSITIONS.get(rec.state, set()):
                    raise UserError(_(
                        'Cannot move a termination from %(old)s to %(new)s.',
                        old=rec.state, new=new,
                    ))
        # Terminal records are immutable (except un-archiving mistakes by admins
        # directly in Odoo, which intentionally requires a state change first).
        protected = self.filtered(lambda r: r.state in ('archived', 'cancelled'))
        if protected:
            changing = set(vals) - {'message_follower_ids', 'activity_ids'}
            if changing:
                raise UserError(_('Archived and cancelled terminations cannot be changed.'))

        # Letter-relevant edits after the letter exists mark the stored PDF outdated.
        # Only genuine value CHANGES count — the portal edit sheet resends every field.
        def _norm(v):
            return False if v in (False, None, '') else str(v)
        letter_changed = set()
        flag_ids = []
        if (LETTER_FIELDS & set(vals)) and 'pdf_outdated' not in vals:
            for r in self:
                if r.state == 'draft' or not (r.pdf_attachment_id or r.signed_pdf_attachment_id):
                    continue
                changed = {f for f in (LETTER_FIELDS & set(vals)) if _norm(vals[f]) != _norm(r[f])}
                if changed:
                    letter_changed |= changed
                    flag_ids.append(r.id)

        res = super().write(vals)

        if flag_ids:
            recs = self.browse(flag_ids)
            super(KwTermination, recs).write({'pdf_outdated': True})
            for r in recs:
                r.message_post(body=_(
                    'A letter-relevant field changed (%s) — the stored PDF may no longer match this record.',
                ) % ', '.join(sorted(letter_changed)))
        return res

    # =================================================================
    # Actions
    # =================================================================
    def action_open_pdf(self):
        """Open the PDF attachment in a new tab."""
        self.ensure_one()
        if not self.pdf_attachment_id:
            raise UserError(_('No PDF on this record.'))
        return {
            'type': 'ir.actions.act_url',
            'url': '/web/content/%s?download=true' % self.pdf_attachment_id.id,
            'target': 'new',
        }

    def action_mark_sent(self):
        """Signed -> In Transit. The letter has left the building."""
        for rec in self:
            if rec.state != 'signed':
                raise UserError(_('Only a signed termination can be marked as sent.'))
            if not rec.delivery_method or not rec.delivery_date:
                raise UserError(_('Record the delivery method and sent date first.'))
            rec.write({'state': 'in_transit'})
            rec.message_post(body=_('Letter sent (%s).') % rec.delivery_method)
        return True

    def action_confirm_delivery(self):
        """In Transit (or Signed, for personal handover) -> Delivered."""
        for rec in self:
            ok = rec.state == 'in_transit' or (
                rec.state == 'signed' and rec.delivery_method in ('personal', 'bote')) or (
                rec.state == 'delivered' and not rec.delivery_confirmed)
            if not ok:
                raise UserError(_('Only a sent termination can be confirmed as delivered.'))
            if rec.state == 'signed' and not rec.delivery_date:
                raise UserError(_('Record the handover date first.'))
            vals = {'state': 'delivered', 'delivery_confirmed': True}
            if not rec.delivery_confirmed_date:
                vals['delivery_confirmed_date'] = fields.Date.today()
            rec.write(vals)
            rec.message_post(body=_('Delivery confirmed.'))
        return True

    def action_archive_employee(self):
        """Delivered -> Archived; deactivates the employee after their last day."""
        for rec in self:
            if rec.state != 'delivered':
                raise UserError(_('Only a delivered termination can be archived.'))
            if not rec.delivery_confirmed:
                raise UserError(_('Confirm delivery before archiving.'))
            if not rec.last_working_day:
                raise UserError(_('Set the last working day before archiving.'))
            if rec.last_working_day > date.today():
                raise UserError(_(
                    'The last working day (%s) has not passed yet.',
                ) % rec.last_working_day)
            if rec.employee_id and rec.employee_id.active:
                rec.employee_id.active = False
            rec.write({'state': 'archived'})
            rec.message_post(body=_('Employee archived; termination completed.'))
        return True

    def action_cancel(self):
        for rec in self:
            if rec.state in ('delivered', 'archived'):
                raise UserError(_('A delivered termination cannot be cancelled.'))
            rec.write({'state': 'cancelled'})
            if rec.employee_id and rec.employee_id.departure_date:
                rec.employee_id.departure_date = False
            rec.message_post(body=_('Termination cancelled.'))
        return True

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            emp = self.employee_id
            self.employee_street = emp.private_street or ''
            self.employee_city = emp.private_city or ''
            self.employee_zip = emp.private_zip or ''
            self.company_id = emp.company_id
