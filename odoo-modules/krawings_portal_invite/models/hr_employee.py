import logging

from odoo import api, models

from ..utils import get_portal_config, portal_post, portal_post_raw

_logger = logging.getLogger(__name__)


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    # --- Manual, confirmed send: the "Send portal invite" button on the form ---

    def action_send_portal_invite(self):
        """User presses the button on the employee form to create + send the
        invite. The employee already exists (and is committed), so a plain
        live-cursor call is fine here. Returns a toast notification."""
        self.ensure_one()
        try:
            status, body = portal_post(
                self.env, '/api/internal/hr/staff-invite', {'employee_id': self.id}
            )
        except Exception as e:
            _logger.warning('[krawings_portal_invite] send invite failed for employee %s: %s', self.id, e)
            return self._invite_notification('Could not reach the portal', str(e), 'danger')

        if status == 200 and body.get('success'):
            if body.get('email_sent'):
                return self._invite_notification(
                    'Invite sent',
                    'A portal invite was emailed to %s.' % (body.get('email') or 'the employee'),
                    'success',
                )
            if body.get('email'):
                return self._invite_notification(
                    'Invite created',
                    'Could not email %s right now. Open the portal Staff Access screen to copy the invite link and share it.' % body.get('email'),
                    'warning',
                )
            return self._invite_notification(
                'Invite created',
                'No email on file for this employee. Open the portal Staff Access screen to copy the invite link.',
                'warning',
            )
        if status == 409:
            return self._invite_notification(
                'Already set up', body.get('error') or 'This employee already has a portal account.', 'warning'
            )
        if status == 404:
            return self._invite_notification(
                'Employee not visible to portal',
                'The portal user cannot see this employee — check the company it belongs to.',
                'warning',
            )
        return self._invite_notification('Invite failed', body.get('error') or ('HTTP %s' % status), 'danger')

    def _invite_notification(self, title, message, ntype):
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {'title': title, 'message': message, 'type': ntype, 'sticky': ntype == 'danger'},
        }

    # --- Optional automatic send on hire (OFF by default; button is the norm) ---

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
        """Automatic invite-on-create is OFF by default — sending is a deliberate
        button press. Set system param krawings.portal_auto_invite_enabled = 1 to
        opt back into automatic sending."""
        val = self.env['ir.config_parameter'].sudo().get_param(
            'krawings.portal_auto_invite_enabled', '0'
        )
        return str(val).strip().lower() in ('1', 'true', 'yes')

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
