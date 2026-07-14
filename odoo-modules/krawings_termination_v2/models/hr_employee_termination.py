from odoo import models, fields, api


class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    termination_count = fields.Integer(
        string='Terminations', compute='_compute_termination_count',
    )

    def _compute_termination_count(self):
        data = self.env['kw.termination'].read_group(
            [('employee_id', 'in', self.ids)],
            ['employee_id'], ['employee_id'],
        )
        mapped = {d['employee_id'][0]: d['employee_id_count'] for d in data}
        for emp in self:
            emp.termination_count = mapped.get(emp.id, 0)

    def action_open_terminations(self):
        self.ensure_one()
        action = self.env['ir.actions.act_window']._for_xml_id(
            'krawings_termination_v2.action_kw_termination',
        )
        action['domain'] = [('employee_id', '=', self.id)]
        action['context'] = {'default_employee_id': self.id}
        if self.termination_count == 1:
            term = self.env['kw.termination'].search(
                [('employee_id', '=', self.id)], limit=1,
            )
            action['views'] = [(False, 'form')]
            action['res_id'] = term.id
        return action
