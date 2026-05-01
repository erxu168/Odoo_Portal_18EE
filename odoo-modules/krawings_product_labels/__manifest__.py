{
    'name': 'Krawings Product Labels',
    'version': '18.0.1.0.0',
    'category': 'Inventory',
    'summary': 'Design and print Zebra shelf labels for products',
    'description': """
        Design custom shelf-edge labels for products and print them
        directly to networked Zebra thermal printers.

        v1 features:
          * Multi-printer registry (one printer per shop / company)
          * Test connection and test print actions
          * (More milestones land in follow-up commits: fonts, templates,
            live preview, Print Labels wizard, ZPL generation, PDF fallback.)
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['base', 'stock', 'product'],
    'data': [
        'security/ir.model.access.csv',
        'views/zebra_printer_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
