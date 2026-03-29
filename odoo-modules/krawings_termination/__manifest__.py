{
    'name': 'Krawings Termination',
    'version': '18.0.1.2.0',
    'category': 'Human Resources',
    'summary': 'Employee termination management with German labor law compliance',
    'description': """
        Complete termination management for German employers:
        - Ordentliche Kuendigung (with/without probation)
        - Fristlose Kuendigung (extraordinary, immediate)
        - Aufhebungsvertrag (mutual termination agreement)
        - Kuendigungsbestaetigung (confirmation of employee resignation)
        - Par. 622 BGB notice period calculator
        - Two calculation methods: statutory (to 15th/month-end) and from receipt date
        - German PDF letter templates with self-contained letterhead
        - Odoo Sign integration with positioned signature + date fields
        - Signed PDF stored on record + Documents app + chatter
        - Send to accountant via email
        - Portal integration via JSON-RPC
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['hr', 'hr_contract', 'mail', 'sign', 'l10n_din5008', 'documents'],
    'data': [
        'security/ir.model.access.csv',
        'data/defaults.xml',
        'data/cron.xml',
        'report/report_actions.xml',
        'report/report_templates.xml',
        'views/kw_termination_views.xml',
        'views/kw_termination_wizard_views.xml',
        'views/hr_employee_views.xml',
        'views/res_config_settings_views.xml',
        'views/menu.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
