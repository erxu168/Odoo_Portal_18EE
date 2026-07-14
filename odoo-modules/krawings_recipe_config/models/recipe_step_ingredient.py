from odoo import models, fields


class KrawingsRecipeStepIngredient(models.Model):
    _name = 'krawings.recipe.step.ingredient'
    _description = 'Recipe Step Ingredient (with quantity)'
    _order = 'step_id, sequence'

    step_id = fields.Many2one(
        'krawings.recipe.step', string='Step',
        ondelete='cascade', required=True, index=True,
    )
    product_id = fields.Many2one(
        'product.product', string='Ingredient',
        ondelete='restrict', required=True, index=True,
    )
    qty = fields.Float(string='Quantity', digits=(12, 3), default=0)
    uom_id = fields.Many2one(
        'uom.uom', string='Unit of Measure',
        help='Unit of measure for this ingredient in this step',
    )
    sequence = fields.Integer(string='Sequence', default=10)
