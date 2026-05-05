# -*- coding: utf-8 -*-
{
    'name': 'Fiskaly Check Disable',
    'version': '18.0.1.0',
    'category': 'Sales/Point of Sale',
    'summary': '''
        Disable fiskaly key check
    ''',
    'description': """
    We are getting a 503 error from fiskaly on the PoS. So we disabled fiskaly on that PoS to be able to continue selling
    This module allows to reopen a session where fiskaly is meant to be set
""",
    'depends': ['l10n_de_pos_cert'],
    'website': '',
    'author': 'Tony',
    'data': [
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
