from odoo import models, fields


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    kw_accountant_email = fields.Char(
        string='Accountant Email',
        config_parameter='krawings_termination.accountant_email',
        help='Email address to send termination letters to. One accountant for all companies.',
    )
    kw_email_subject_template = fields.Char(
        string='Email Subject Template',
        config_parameter='krawings_termination.email_subject_template',
        default='Kuendigung: {employee_name} - {company}',
        help='Available variables: {employee_name}, {company}, {type}, {last_day}',
    )
