from odoo import models, fields


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    x_recipe_guide = fields.Boolean(
        string='Include in Recipe Guide',
        default=False,
        help='Show this product in the Krawings Recipe Guide PWA',
    )
    x_recipe_category_id = fields.Many2one(
        'krawings.recipe.category',
        string='Recipe Category',
        domain=[('mode', '=', 'cooking_guide')],
    )
    x_recipe_published = fields.Boolean(
        string='Recipe Published',
        default=False,
        help='Only published recipes are visible to staff in Cook mode',
    )
    x_recipe_difficulty = fields.Selection([
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
    ], string='Difficulty')
    x_recipe_step_ids = fields.One2many(
        'krawings.recipe.step', 'product_tmpl_id',
        string='Cooking Steps',
    )
    x_recipe_version_ids = fields.One2many(
        'krawings.recipe.version', 'product_tmpl_id',
        string='Recipe Versions',
    )
    x_recipe_step_count = fields.Integer(
        string='Step Count',
        compute='_compute_recipe_step_count',
    )

    def _compute_recipe_step_count(self):
        for rec in self:
            rec.x_recipe_step_count = len(rec.x_recipe_step_ids)
