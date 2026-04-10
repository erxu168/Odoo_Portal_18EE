{
    'name': 'Krawings Supplier Credentials',
    'version': '18.0.1.0.0',
    'category': 'Purchase',
    'summary': 'Store supplier portal login credentials per company',
    'description': """
        Adds a child model on res.partner to store per-company
        login credentials for supplier ordering platforms.
        Used by the Krawings Portal to display credentials
        to managers and admins.
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['base', 'purchase'],
    'data': [
        'security/ir.model.access.csv',
        'views/supplier_login_views.xml',
        'views/res_partner_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
