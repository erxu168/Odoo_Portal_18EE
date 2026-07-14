from odoo import models, fields, api


class KrawingsRecipeCategory(models.Model):
    _name = 'krawings.recipe.category'
    _description = 'Recipe Guide Category'
    _order = 'sequence, name'

    name = fields.Char(string='Name', required=True, translate=True)
    sequence = fields.Integer(string='Sequence', default=10)
    icon = fields.Char(string='Icon', help='Emoji or icon code for PWA display')
    mode = fields.Selection([
        ('cooking_guide', 'Cooking Guide'),
        ('production_guide', 'Production Guide'),
    ], string='Mode', required=True, default='cooking_guide')
    warehouse_ids = fields.Many2many(
        'stock.warehouse',
        'recipe_category_warehouse_rel',
        'category_id', 'warehouse_id',
        string='Warehouses',
        help='Which locations this category applies to (e.g. SSAM, GBM38)',
    )
    active = fields.Boolean(default=True)
    recipe_count = fields.Integer(
        string='Recipe Count', compute='_compute_recipe_count',
    )

    @api.depends()
    def _compute_recipe_count(self):
        for rec in self:
            product_count = self.env['product.template'].search_count([
                ('x_recipe_category_id', '=', rec.id),
            ])
            bom_count = self.env['mrp.bom'].search_count([
                ('x_recipe_category_id', '=', rec.id),
            ])
            rec.recipe_count = product_count + bom_count
