# -*- coding: utf-8 -*-
{
    'name': 'Fiskaly Customizations',
    'version': '18.0.1.0',
    'category': 'Sales/Point of Sale',
    'summary': '''
    ''',
    'description': """
    """,
    'depends': ['l10n_de_pos_res_cert', 'pos_survey_dynamic_fields', 'krawings_pos_receipt'],
    'website': '',
    'author': 'Joshua',
    'data': [
        'views/pos_session_views.xml',
        'views/survey_views.xml',
        'views/res_config_settings_views.xml',
    ],
    'installable': True,
    'application': False,
    'assets': {
        'point_of_sale._assets_pos': [
            'fiskaly_customization/static/src/app/store/**/*',
        ],
    },
    'license': 'LGPL-3',
}
