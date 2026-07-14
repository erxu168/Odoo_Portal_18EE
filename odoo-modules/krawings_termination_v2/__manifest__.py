{
    'name': 'Krawings Termination v2',
    'version': '18.0.2.0.0',
    'category': 'Human Resources',
    'summary': 'Employee termination data layer - minimal Odoo module',
    'description': """
        Data model for employee termination management.
        UI and PDF generation handled by Krawings Portal.

        Features:
        - kw.termination model with Par. 622 BGB notice period engine
        - Delivery tracking fields
        - Termination stat button on hr.employee form
        - Simple list/form views for browsing in Odoo
        - No QWeb reports, no PDF generation, no Odoo Sign
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['hr', 'hr_contract', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/kw_termination_views.xml',
        'views/hr_employee_views.xml',
        'views/menu.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
