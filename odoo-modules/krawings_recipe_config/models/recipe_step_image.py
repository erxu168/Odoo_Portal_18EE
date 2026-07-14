from odoo import models, fields


class KrawingsRecipeStepImage(models.Model):
    _name = 'krawings.recipe.step.image'
    _description = 'Recipe Step Image'
    _order = 'sort, id'

    step_id = fields.Many2one(
        'krawings.recipe.step', string='Step',
        required=True, ondelete='cascade', index=True,
    )
    image = fields.Binary(string='Image', required=True, attachment=True)
    caption = fields.Char(string='Caption')
    source = fields.Selection([
        ('record', 'Recorded in kitchen'),
        ('upload', 'Uploaded'),
    ], string='Source', default='upload')
    sort = fields.Integer(string='Sort Order', default=10)
