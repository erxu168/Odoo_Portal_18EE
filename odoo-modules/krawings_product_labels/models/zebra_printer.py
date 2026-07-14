import logging
import socket

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_SECONDS = 5

SAMPLE_TEST_ZPL = (
    "^XA"
    "^FO40,40^A0N,40,40^FDKrawings Test Print^FS"
    "^FO40,100^A0N,28,28^FD{printer_name}^FS"
    "^FO40,150^A0N,22,22^FDIf you can read this, the printer is wired up.^FS"
    "^XZ"
)


class ZebraPrinter(models.Model):
    _name = 'krawings.zebra.printer'
    _description = 'Zebra Label Printer'
    _order = 'company_id, name'

    name = fields.Char(
        string='Printer Name',
        required=True,
        help='Friendly name shown in print dialogs (e.g. "What a Jerk - Back Office").',
    )
    ip_address = fields.Char(
        string='IP Address or Hostname',
        required=True,
        help='Network address of the Zebra on the shop wifi (e.g. "192.168.1.50").',
    )
    port = fields.Integer(
        string='Port',
        default=9100,
        required=True,
        help='Raw print port. Zebra default is 9100; rarely needs to change.',
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company,
        help='Which shop this printer belongs to. Used to auto-pick the printer when '
             'staff print labels for products from this company.',
    )
    active = fields.Boolean(default=True)
    note = fields.Text(string='Notes', help='Internal notes (location, model, etc.).')

    _sql_constraints = [
        (
            'name_company_unique',
            'unique (name, company_id)',
            'A printer with this name already exists for this company.',
        ),
    ]

    def _send_zpl(self, zpl_payload):
        """Open a TCP socket to the printer and write ZPL bytes.

        Raises UserError on any network failure so the caller surfaces a
        clean message in the UI instead of a traceback.
        """
        self.ensure_one()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(CONNECT_TIMEOUT_SECONDS)
        try:
            sock.connect((self.ip_address, self.port))
            sock.sendall(zpl_payload.encode('utf-8'))
        except socket.timeout as exc:
            raise UserError(_(
                "Timed out connecting to %(name)s at %(addr)s:%(port)s. "
                "Check that the printer is on and on the same network.",
                name=self.name, addr=self.ip_address, port=self.port,
            )) from exc
        except OSError as exc:
            raise UserError(_(
                "Could not reach %(name)s at %(addr)s:%(port)s.\n%(err)s",
                name=self.name, addr=self.ip_address, port=self.port, err=exc,
            )) from exc
        finally:
            sock.close()

    def action_test_connection(self):
        """Open then close a TCP socket without sending data."""
        self.ensure_one()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(CONNECT_TIMEOUT_SECONDS)
        try:
            sock.connect((self.ip_address, self.port))
        except socket.timeout as exc:
            _logger.warning("Zebra %s connection timeout (%s:%s)", self.name, self.ip_address, self.port)
            raise UserError(_(
                "Connection timed out for %(name)s.", name=self.name,
            )) from exc
        except OSError as exc:
            _logger.warning("Zebra %s connection error: %s", self.name, exc)
            raise UserError(_(
                "Cannot reach %(name)s at %(addr)s:%(port)s.\n%(err)s",
                name=self.name, addr=self.ip_address, port=self.port, err=exc,
            )) from exc
        finally:
            sock.close()
        _logger.info("Zebra %s reachable at %s:%s", self.name, self.ip_address, self.port)
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _("Connection OK"),
                'message': _(
                    "Reached %(name)s at %(addr)s:%(port)s.",
                    name=self.name, addr=self.ip_address, port=self.port,
                ),
                'type': 'success',
                'sticky': False,
            },
        }

    def action_test_print(self):
        """Send a small sample ZPL so the user can confirm the printer works end to end."""
        self.ensure_one()
        payload = SAMPLE_TEST_ZPL.format(printer_name=self.name)
        self._send_zpl(payload)
        _logger.info("Zebra %s test print sent", self.name)
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _("Test print sent"),
                'message': _("A sample label should come out of %(name)s now.", name=self.name),
                'type': 'success',
                'sticky': False,
            },
        }

    @api.constrains('port')
    def _check_port(self):
        for rec in self:
            if not (1 <= rec.port <= 65535):
                raise UserError(_("Port must be between 1 and 65535."))
