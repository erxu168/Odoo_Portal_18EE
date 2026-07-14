# -*- coding: utf-8 -*-
from odoo import models, fields


class MaintenanceEquipment(models.Model):
    _inherit = 'maintenance.equipment'

    x_portal_id = fields.Char(
        string='Portal UUID',
        help='UUID from the Krawings Portal issues_equipment table. '
             'Used to correlate portal equipment records with Odoo.',
        index=True,
    )
    x_qr_code = fields.Char(
        string='Portal QR Code',
        help='QR code payload printed on physical stickers. '
             'When staff scan the sticker, the portal looks up the '
             'equipment by this value.',
        index=True,
    )
    x_portal_repair_count = fields.Integer(
        string='Portal Repair Count',
        default=0,
        help='Running count of repairs logged via the portal.',
    )
    x_portal_total_cost = fields.Float(
        string='Portal Total Repair Cost',
        default=0.0,
        help='Running total of repair costs logged via the portal (EUR).',
    )

    _sql_constraints = [
        (
            'x_portal_id_unique',
            'UNIQUE(x_portal_id)',
            'Portal UUID must be unique across all equipment records.',
        ),
    ]
