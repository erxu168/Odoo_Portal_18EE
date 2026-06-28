import logging

from odoo import api, models

from ..utils import portal_post

_logger = logging.getLogger(__name__)


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    @api.model_create_multi
    def create(self, vals_list):
        employees = super().create(vals_list)
        if self._portal_auto_invite_enabled():
            for emp in employees:
                self._notify_portal_invite(emp.id)
        return employees

    def _portal_auto_invite_enabled(self):
        """Master switch so a large employee import can be run without
        firing hundreds of invites: set system param
        krawings.portal_auto_invite_enabled = 0 to disable."""
        val = self.env['ir.config_parameter'].sudo().get_param(
            'krawings.portal_auto_invite_enabled', '1'
        )
        return str(val).strip().lower() not in ('0', 'false', 'no', '')

    def _notify_portal_invite(self, employee_id):
        """Best-effort: ask the portal to create + email an invite for a new
        employee. Never raises — employee creation must not depend on the portal."""
        try:
            status, body = portal_post(
                self.env, '/api/internal/hr/staff-invite', {'employee_id': employee_id}
            )
            if status == 200 and body.get('success'):
                _logger.info(
                    '[krawings_portal_invite] portal invite created for employee %s', employee_id
                )
            else:
                _logger.warning(
                    '[krawings_portal_invite] portal invite for employee %s returned HTTP %s: %s',
                    employee_id, status, body,
                )
        except Exception as e:
            _logger.warning(
                '[krawings_portal_invite] could not reach portal for employee %s: %s',
                employee_id, e,
            )
