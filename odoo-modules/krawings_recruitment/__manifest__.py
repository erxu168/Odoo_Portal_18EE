{
    'name': 'Krawings Recruitment Portal',
    'version': '18.0.1.2.0',
    'category': 'Human Resources',
    'summary': 'Grant portal access and create employees from applicants',
    'depends': ['hr_recruitment'],
    'data': [
        'security/ir.model.access.csv',
        'wizard/grant_portal_access_views.xml',
        'wizard/create_employee_views.xml',
        'views/hr_applicant_views.xml',
    ],
    'installable': True,
    'license': 'LGPL-3',
}
