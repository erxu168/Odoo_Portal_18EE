{
    'name': 'Krawings Issues Portal Sync',
    'version': '18.0.1.0.0',
    'category': 'Maintenance',
    'summary': 'Bridge between Krawings Portal Issues & Requests module and Odoo Maintenance',
    'description': """
Krawings Issues Portal Sync
============================
Extends maintenance.equipment with portal tracking fields and exposes
a JSON controller endpoint for the Next.js portal to sync equipment
records with Odoo 18 EE Maintenance module.

Extended fields on maintenance.equipment:
- x_portal_id: UUID from portal's issues_equipment table
- x_qr_code: QR code payload used on printed stickers
- x_portal_repair_count: running count of repairs logged via portal
- x_portal_total_cost: running repair cost total in EUR

Exposes:
- POST /krawings/issues/sync_equipment (JSON)
- POST /krawings/issues/ping (health check)
""",
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'depends': ['maintenance'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
