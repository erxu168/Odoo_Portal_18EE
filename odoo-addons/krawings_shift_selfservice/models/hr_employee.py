# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import ValidationError


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    x_max_weekly_hours = fields.Float(
        string='Max Weekly Hours',
        help='Maximum hours this employee should work per ISO week '
             '(Mon-Sun). Used by the Krawings Portal shift self-service '
             'module as a SOFT cap: staff can still claim shifts that '
             'exceed it, but they are warned and the shift is flagged for '
             'the manager. For working students this is typically 20.0. '
             'Left empty means no cap is enforced.',
    )
    x_skill_level = fields.Selection(
        selection=[
            ('1', 'Trainee'),
            ('2', 'Associate'),
            ('3', 'Team Lead'),
        ],
        string='Shift Skill Level',
        help='Capability tier used by the Krawings Portal scheduler. '
             '1 Trainee = must always be paired with a more experienced '
             'colleague; '
             '2 Associate = can hold a shift on their own; '
             '3 Team Lead = can work alone and is trained on every task. '
             'Drives skill-safety rules in both self-service warnings and '
             'the auto-scheduling engine.',
    )

    @api.constrains('x_max_weekly_hours')
    def _check_max_weekly_hours(self):
        for emp in self:
            if emp.x_max_weekly_hours and emp.x_max_weekly_hours < 0:
                raise ValidationError(
                    'Max Weekly Hours cannot be negative.'
                )
