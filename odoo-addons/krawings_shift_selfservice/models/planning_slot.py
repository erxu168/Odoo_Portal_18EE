# -*- coding: utf-8 -*-
from odoo import models, fields


class PlanningSlot(models.Model):
    _inherit = 'planning.slot'

    x_over_cap_flag = fields.Boolean(
        string='Over Weekly Cap',
        default=False,
        index=True,
        help='Set by the Krawings Portal when this shift was claimed by '
             '(or assigned to) an employee whose total ISO-week hours then '
             'exceeded their Max Weekly Hours. Stored rather than computed '
             'so the manager Coverage view can filter on it cheaply. The '
             'portal is responsible for setting and clearing this flag when '
             'assignments change.',
    )
