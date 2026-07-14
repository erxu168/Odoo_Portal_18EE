# -*- coding: utf-8 -*-
import logging
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class KrawingsIssuesController(http.Controller):
    """JSON-RPC endpoints for the Krawings Portal Issues & Requests module."""

    @http.route(
        '/krawings/issues/sync_equipment',
        type='json',
        auth='user',
        methods=['POST'],
        csrf=False,
    )
    def sync_equipment(self, **kw):
        """
        Upsert a maintenance.equipment record from the portal.

        Expected payload (JSON-RPC params):
          {
            "portal_id": "uuid-from-portal",
            "qr_code": "uuid-for-qr-sticker",
            "name": "Combi Oven #1",
            "brand": "Rational",
            "model": "iCombi Pro 10-1/1",
            "serial_number": "...",
            "location": "SSAM Kottbusser Damm",
            "purchase_date": "2024-03-15",
            "purchase_cost": 8500.00,
            "warranty_expires": "2026-03-15",
            "vendor_name": "Rational AG",
            "repair_count": 0,
            "total_cost": 0.0,
          }

        Returns:
          { "odoo_id": <int>, "created": <bool> }
        """
        portal_id = kw.get('portal_id')
        if not portal_id:
            return {'error': 'portal_id is required'}

        Equipment = request.env['maintenance.equipment'].sudo()

        # Upsert by portal UUID
        existing = Equipment.search([('x_portal_id', '=', portal_id)], limit=1)

        vals = {
            'name': kw.get('name') or 'Unnamed Equipment',
            'x_portal_id': portal_id,
            'x_qr_code': kw.get('qr_code'),
            'model': kw.get('model'),
            'serial_no': kw.get('serial_number'),
            'location': kw.get('location'),
            'x_portal_repair_count': kw.get('repair_count', 0),
            'x_portal_total_cost': kw.get('total_cost', 0.0),
        }

        if kw.get('purchase_date'):
            vals['effective_date'] = kw['purchase_date']
        if kw.get('purchase_cost') is not None:
            vals['cost'] = kw['purchase_cost']

        # Warranty field: try the Odoo 18 standard name first, fallback gracefully.
        # Odoo 18 uses 'warranty_date'; some builds have 'warranty_expiration_date'.
        warranty = kw.get('warranty_expires')
        if warranty:
            equipment_fields = Equipment.fields_get()
            if 'warranty_date' in equipment_fields:
                vals['warranty_date'] = warranty
            elif 'warranty_expiration_date' in equipment_fields:
                vals['warranty_expiration_date'] = warranty

        # Vendor: resolve or create partner
        if kw.get('vendor_name'):
            Partner = request.env['res.partner'].sudo()
            partner = Partner.search(
                [('name', '=', kw['vendor_name']), ('supplier_rank', '>', 0)],
                limit=1,
            )
            if not partner:
                partner = Partner.search([('name', '=', kw['vendor_name'])], limit=1)
            if not partner:
                partner = Partner.create({
                    'name': kw['vendor_name'],
                    'supplier_rank': 1,
                    'company_type': 'company',
                })
            vals['partner_id'] = partner.id

        # Strip None values so we don't clobber existing fields with nulls
        vals = {k: v for k, v in vals.items() if v is not None}

        if existing:
            existing.write(vals)
            _logger.info(
                'krawings_issues: updated equipment %s (portal_id=%s)',
                existing.id, portal_id,
            )
            return {'odoo_id': existing.id, 'created': False}
        else:
            new_eq = Equipment.create(vals)
            _logger.info(
                'krawings_issues: created equipment %s (portal_id=%s)',
                new_eq.id, portal_id,
            )
            return {'odoo_id': new_eq.id, 'created': True}

    @http.route(
        '/krawings/issues/ping',
        type='json',
        auth='user',
        methods=['POST'],
        csrf=False,
    )
    def ping(self, **kw):
        """Health check — confirms the module is installed and reachable."""
        return {
            'status': 'ok',
            'module': 'krawings_issues',
            'version': '18.0.1.0.0',
            'user': request.env.user.login,
        }
