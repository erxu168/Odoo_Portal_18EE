from odoo import models, fields


class KrawingsRecipeRecording(models.Model):
    _name = 'krawings.recipe.recording'
    _description = 'Recipe Recording Session'
    _order = 'create_date desc'

    product_tmpl_id = fields.Many2one(
        'product.template', string='Product',
        ondelete='cascade', index=True,
    )
    bom_id = fields.Many2one(
        'mrp.bom', string='Bill of Materials',
        ondelete='cascade', index=True,
    )
    recorded_by_id = fields.Many2one(
        'res.users', string='Recorded By',
        default=lambda self: self.env.uid,
    )
    started_at = fields.Datetime(string='Started At')
    ended_at = fields.Datetime(string='Ended At')
    total_seconds = fields.Integer(string='Total Duration (sec)')
    step_count = fields.Integer(string='Steps Captured')
    status = fields.Selection([
        ('recording', 'In Progress'),
        ('done', 'Completed'),
        ('converted', 'Converted to Steps'),
    ], string='Status', default='recording')
