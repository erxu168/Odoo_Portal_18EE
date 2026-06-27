import logging

from odoo import fields, models
from odoo.exceptions import UserError

from ..utils import portal_post

_logger = logging.getLogger(__name__)


class CreateEmployeeWizard(models.TransientModel):
    _name = 'create.employee.wizard'
    _description = 'Create Employee from Applicant'

    applicant_id = fields.Many2one(
        'hr.applicant', string='Applicant', required=True,
        default=lambda self: self.env.context.get('active_id'),
    )
    applicant_name = fields.Char(related='applicant_id.partner_name', readonly=True)
    applicant_email = fields.Char(related='applicant_id.email_from', readonly=True)
    department_id = fields.Many2one(related='applicant_id.department_id', readonly=True)
    job_id = fields.Many2one(related='applicant_id.job_id', readonly=True)
    employee_created = fields.Boolean(default=False)
    result_message = fields.Text(readonly=True)

    def action_create_employee(self):
        self.ensure_one()
        applicant = self.applicant_id
        candidate = applicant.candidate_id

        if not candidate:
            raise UserError('This applicant has no candidate record.')

        if candidate.employee_id:
            raise UserError(
                'An employee already exists for this candidate: %s' % candidate.employee_id.name
            )

        vals = {
            'name': candidate.partner_name or applicant.partner_name or 'New Employee',
            'work_email': candidate.email_from or '',
            'mobile_phone': candidate.partner_phone or '',
        }
        if applicant.department_id:
            vals['department_id'] = applicant.department_id.id
        if applicant.job_id:
            vals['job_id'] = applicant.job_id.id

        employee = self.env['hr.employee'].sudo().create(vals)
        candidate.sudo().write({'employee_id': employee.id})

        _logger.info(
            '[krawings_recruitment] Created employee %s (ID %s) from applicant %s',
            employee.name, employee.id, applicant.partner_name,
        )

        # Ask the portal to upgrade the candidate's portal account to a full
        # employee. Best-effort: the Odoo employee already exists and must not be
        # rolled back, so this never raises — it only annotates the result.
        portal_note = self._promote_portal_user(applicant.id, employee.id)

        self.write({
            'employee_created': True,
            'result_message': (
                'Employee created successfully!\n\n'
                'Name: %s\n'
                'Email: %s\n'
                'Employee ID: %s\n\n'
                '%s'
            ) % (employee.name, employee.work_email, employee.id, portal_note),
        })

        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def _promote_portal_user(self, applicant_id, employee_id):
        """Notify the portal to link the candidate's portal account to the new
        employee. Returns a human-readable status line; never raises."""
        try:
            status, body = portal_post(
                self.env,
                '/api/internal/hr/recruitment/promote-to-employee',
                {'applicant_id': applicant_id, 'employee_id': employee_id},
            )
        except Exception as e:
            _logger.warning(
                '[krawings_recruitment] Could not reach portal to promote applicant %s: %s',
                applicant_id, e,
            )
            return ('Note: the employee was created, but the portal could not be '
                    'reached to upgrade the candidate account. This can be retried later.')

        if status == 200 and body.get('success'):
            return "The candidate's portal account was upgraded to a full employee."
        if status == 404:
            return ('Note: this applicant has no portal account, so there was nothing '
                    'to upgrade. (Use "Grant Portal Access" first if they need one.)')

        _logger.warning(
            '[krawings_recruitment] Portal promote returned HTTP %s: %s', status, body,
        )
        return ('Note: the employee was created, but the portal reported a problem '
                'upgrading the candidate account: %s') % (body.get('error', 'unknown error'),)
