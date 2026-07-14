from odoo import models, fields, api


class KrawingsRecipeStep(models.Model):
    _name = 'krawings.recipe.step'
    _description = 'Recipe Guide Step'
    _order = 'product_tmpl_id, bom_id, sequence'

    # Parent link (one of these is set, not both)
    product_tmpl_id = fields.Many2one(
        'product.template', string='Product',
        ondelete='cascade', index=True,
        help='For Cooking Guide recipes (POS menu items)',
    )
    bom_id = fields.Many2one(
        'mrp.bom', string='Bill of Materials',
        ondelete='cascade', index=True,
        help='For Production Guide recipes',
    )

    # Step data
    sequence = fields.Integer(string='Sequence', default=10)
    name = fields.Char(
        string='Step Label', compute='_compute_name', store=True,
    )
    step_type = fields.Selection([
        ('prep', 'Prep'),
        ('cook', 'Cook'),
        ('plate', 'Plate'),
    ], string='Step Type', default='prep', required=True)
    instruction = fields.Html(string='Instruction', sanitize=True)
    timer_seconds = fields.Integer(
        string='Timer (seconds)', default=0,
        help='0 = no timer. Cook timer in seconds.',
    )
    tip = fields.Text(string='Chef Tip')

    # Ingredients used in this step
    ingredient_ids = fields.Many2many(
        'product.product',
        'recipe_step_ingredient_rel',
        'step_id', 'product_id',
        string='Ingredients',
        help='Which ingredients are used in this specific step',
    )

    # New: Ingredients with quantities
    step_ingredient_ids = fields.One2many(
        'krawings.recipe.step.ingredient', 'step_id',
        string='Step Ingredients (with qty)',
    )

    # Images
    image_ids = fields.One2many(
        'krawings.recipe.step.image', 'step_id',
        string='Step Images',
    )
    image_count = fields.Integer(
        string='Photos', compute='_compute_image_count',
    )

    # Metadata
    version_id = fields.Many2one(
        'krawings.recipe.version', string='Version',
        ondelete='set null',
    )

    @api.depends('sequence', 'step_type')
    def _compute_name(self):
        for step in self:
            step.name = 'Step %d - %s' % (
                step.sequence // 10 if step.sequence >= 10 else step.sequence,
                dict(self._fields['step_type'].selection).get(step.step_type, ''),
            )

    @api.depends('image_ids')
    def _compute_image_count(self):
        for step in self:
            step.image_count = len(step.image_ids)
