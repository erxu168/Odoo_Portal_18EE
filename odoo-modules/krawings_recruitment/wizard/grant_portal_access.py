import logging

import requests

from odoo import fields, models
from odoo.exceptions import UserError

from ..utils import portal_post

_logger = logging.getLogger(__name__)


class GrantPortalAccessWizard(models.TransientModel):
    _name = "grant.portal.access.wizard"
    _description = "Grant Portal Access to Applicant"

    applicant_id = fields.Many2one(
        "hr.applicant",
        string="Applicant",
        required=True,
        default=lambda self: self.env.context.get("active_id"),
    )
    applicant_name = fields.Char(
        related="applicant_id.partner_name",
        string="Applicant Name",
        readonly=True,
    )
    applicant_email = fields.Char(
        related="applicant_id.email_from",
        string="Email",
        readonly=True,
    )
    temp_password = fields.Char(string="Temporary Password", readonly=True)
    portal_url = fields.Char(string="Portal URL", readonly=True)
    result_message = fields.Text(string="Result", readonly=True)
    access_granted = fields.Boolean(default=False)

    def action_grant_access(self):
        """Create a portal account for the applicant via the portal's secure
        internal endpoint.

        The portal owns the account details: it reads the applicant's name and
        email straight from Odoo, generates the password, and emails the
        candidate. We only send the applicant id (authenticated with the shared
        bearer token) and surface whatever the portal returns.
        """
        self.ensure_one()
        applicant = self.applicant_id

        if not applicant.email_from:
            raise UserError(
                "The applicant does not have an email address. "
                "Please set the email before granting portal access."
            )
        if not applicant.partner_name:
            raise UserError(
                "The applicant does not have a name. "
                "Please set the applicant name before granting portal access."
            )

        _logger.info(
            "[krawings_recruitment] Granting portal access for applicant %s (%s)",
            applicant.partner_name,
            applicant.email_from,
        )

        try:
            status, body = portal_post(
                self.env,
                "/api/internal/hr/recruitment/create-access",
                {"applicant_id": applicant.id},
            )
        except ValueError as e:
            # Configuration problem (e.g. missing token) — show it plainly.
            raise UserError(str(e))
        except requests.exceptions.ConnectionError:
            raise UserError(
                "Could not connect to the portal server. "
                "Please verify the portal service is running."
            )
        except requests.exceptions.Timeout:
            raise UserError(
                "The portal server did not respond in time. Please try again."
            )
        except Exception as e:
            _logger.exception(
                "[krawings_recruitment] Unexpected error granting portal access"
            )
            raise UserError("Unexpected error contacting the portal: %s" % e)

        if status != 200 or not body.get("success"):
            error = body.get("error") or "Unknown error (HTTP %s)" % status
            raise UserError("Portal server returned an error:\n\n%s" % error)

        email_sent = body.get("email_sent")
        # temp_password is only returned when the welcome email failed to send.
        temp_password = body.get("temp_password")
        candidate_name = body.get("candidate_name", applicant.partner_name)
        candidate_email = body.get("candidate_email", applicant.email_from)

        if email_sent:
            result_message = (
                "Portal access has been granted successfully!\n\n"
                "A welcome email with login details was sent to:\n"
                "%s (%s)\n\n"
                "The candidate can now log in to the portal."
            ) % (candidate_name, candidate_email)
        else:
            result_message = (
                "Portal access was granted, but the welcome email could NOT be "
                "sent.\n\n"
                "Please share these credentials with the candidate securely:\n\n"
                "Name: %s\n"
                "Email / login: %s\n"
                "Temporary password: %s\n\n"
                "%s"
            ) % (
                candidate_name,
                candidate_email,
                temp_password or "(not returned)",
                body.get("warning", ""),
            )

        self.write({
            "temp_password": temp_password or False,
            "result_message": result_message,
            "access_granted": True,
        })

        _logger.info(
            "[krawings_recruitment] Portal access granted for %s (email_sent=%s)",
            candidate_email,
            email_sent,
        )

        return {
            "type": "ir.actions.act_window",
            "res_model": self._name,
            "res_id": self.id,
            "view_mode": "form",
            "target": "new",
        }
