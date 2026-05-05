from odoo import models, fields, api


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    pos_alternate_config_id = fields.Many2one('pos.config', related='pos_config_id.alternate_config_id', readonly=False)
    pos_fiskaly_qualify_points = fields.Integer(related='pos_config_id.fiskaly_qualify_points', readonly=False)
    pos_evaluate_scores = fields.Boolean(related='pos_config_id.evaluate_scores', readonly=False)
                