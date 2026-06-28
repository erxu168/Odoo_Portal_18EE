import logging

from odoo import api, models

from ..utils import get_portal_config, portal_post_raw

_logger = logging.getLogger(__name__)


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    @api.model_create_multi
    def create(self, vals_list):
        employees = super().create(vals_list)
        if self._portal_auto_invite_enabled():
            # Read config now (live cursor) and notify the portal only AFTER the
            # transaction commits — otherwise the portal's separate Odoo session
            # cannot yet see the new employee and the invite would 404.
            base_url, token = get_portal_config(self.env)
            uid = self.env.uid
            ids = list(employees.ids)
            self.env.cr.postcommit.add(lambda: self._post_invites(base_url, token, uid, ids))
        return employees

    def _portal_auto_invite_enabled(self):
        """Master switch so a large employee import can be run without firing
        hundreds of invites: set system param
        krawings.portal_auto_invite_enabled = 0 to disable."""
        val = self.env['ir.config_parameter'].sudo().get_param(
            'krawings.portal_auto_invite_enabled', '1'
        )
        return str(val).strip().lower() not in ('0', 'false', 'no', '')

    @staticmethod
    def _post_invites(base_url, token, uid, ids):
        """Post-commit callback: best-effort invite for each new employee.
        Never raises — employee creation must not depend on the portal."""
        for emp_id in ids:
            try:
                status, body = portal_post_raw(
                    base_url, token, uid, '/api/internal/hr/staff-invite', {'employee_id': emp_id}
                )
                if status == 200 and body.get('success'):
                    _logger.info('[krawings_portal_invite] portal invite created for employee %s', emp_id)
                else:
                    _logger.warning(
                        '[krawings_portal_invite] portal invite for employee %s returned HTTP %s: %s',
                        emp_id, status, body,
                    )
            except Exception as e:
                _logger.warning(
                    '[krawings_portal_invite] could not reach portal for employee %s: %s', emp_id, e
                )
