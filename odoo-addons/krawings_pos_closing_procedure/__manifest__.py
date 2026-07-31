# © 2024 mauricejansz (<https://github.com/mauricejansz>)
# License OPL-1, See LICENSE file for full copyright and licensing details.
{
    "name": "Krawings Closing Procedure",
    "version": "18.0.1.3",
    "author": "Tony",
    "license": "OPL-1",
    "category": "Point of Sale",
    "depends": ["pos_restaurant", "hr", 'pos_hr', 'pos_survey'],
    "description": """
        Custom POS Closing procedure
    """,
    "data": [
        "data/mail_template_data.xml",
        "views/res_config_settings_views.xml",
        "views/pos_session_views.xml",
        "views/report_saledetails.xml"
    ],
    "assets": {
        'point_of_sale._assets_pos': [
            'krawings_pos_closing_procedure/static/src/**/*',
        ],
    },
    "installable": True,
}
