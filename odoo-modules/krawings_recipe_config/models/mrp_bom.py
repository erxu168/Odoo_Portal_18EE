from odoo import models, fields, api
from odoo.exceptions import ValidationError


class MrpBom(models.Model):
    _inherit = 'mrp.bom'

    x_recipe_guide = fields.Boolean(
        string='Include in Recipe Guide',
        default=False,
        help='Show this BoM in the Krawings Recipe Guide PWA',
    )
    x_recipe_category_id = fields.Many2one(
        'krawings.recipe.category',
        string='Recipe Category',
        domain=[('mode', '=', 'production_guide')],
    )
    x_recipe_published = fields.Boolean(
        string='Recipe Published',
        default=False,
        help='Only published recipes are visible to staff in Cook mode',
    )
    x_cook_time_min = fields.Integer(
        string='Est. Cook Time (min)',
        help='Estimated total cooking time in minutes',
    )
    x_recipe_difficulty = fields.Selection([
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
    ], string='Difficulty')
    x_recipe_step_ids = fields.One2many(
        'krawings.recipe.step', 'bom_id',
        string='Cooking Steps',
    )
    x_recipe_version_ids = fields.One2many(
        'krawings.recipe.version', 'bom_id',
        string='Recipe Versions',
    )
    x_recipe_step_count = fields.Integer(
        string='Step Count',
        compute='_compute_recipe_step_count',
    )

    def _compute_recipe_step_count(self):
        for rec in self:
            rec.x_recipe_step_count = len(rec.x_recipe_step_ids)

    version_label = fields.Char(
        string='Version',
        default='v.1',
        copy=False,
        help='Free-form label for this BOM version (e.g. "v.3", "v.3 — lime"). Suggested but not enforced.',
    )
    version_notes = fields.Text(
        string='Version Notes',
        copy=False,
        help="What changed in this version and why.",
    )
    version_parent_id = fields.Many2one(
        'mrp.bom',
        string='Derived From',
        ondelete='restrict',
        index=True,
        copy=False,
        help='The BOM version this one was derived from.',
    )
    version_root_id = fields.Many2one(
        'mrp.bom',
        string='Recipe Root',
        compute='_compute_version_root_id',
        store=True,
        index=True,
        recursive=True,
        help='The first version in this recipe chain (root of the version tree).',
    )
    is_current_version = fields.Boolean(
        string='Current Version',
        default=True,
        index=True,
        copy=False,
        help='Marks this BOM as the default for new MOs of its product. Exactly one BOM per recipe chain may be current.',
    )
    version_count = fields.Integer(
        string='Version Count',
        compute='_compute_version_count',
    )

    @api.depends('version_parent_id', 'version_parent_id.version_root_id')
    def _compute_version_root_id(self):
        for bom in self:
            bom.version_root_id = bom.version_parent_id.version_root_id or bom

    @api.depends('version_root_id')
    def _compute_version_count(self):
        # Walk by each BOM's root, not by self.ids — self contains
        # arbitrary versions in the chain, and we want the total count
        # of BOMs sharing each one's root.
        root_ids = list({bom.version_root_id.id for bom in self if bom.version_root_id})
        counts = {}
        if root_ids:
            grouped = self.env['mrp.bom'].read_group(
                [('version_root_id', 'in', root_ids)],
                ['version_root_id'],
                ['version_root_id'],
            )
            counts = {g['version_root_id'][0]: g['version_root_id_count'] for g in grouped}
        for bom in self:
            bom.version_count = counts.get(bom.version_root_id.id, 1)

    @api.constrains('is_current_version', 'version_root_id')
    def _check_single_current_version(self):
        for bom in self:
            if not bom.is_current_version:
                continue
            others = self.env['mrp.bom'].search([
                ('id', '!=', bom.id),
                ('version_root_id', '=', bom.version_root_id.id),
                ('is_current_version', '=', True),
            ], limit=1)
            if others:
                raise ValidationError(
                    f"Another version of this recipe is already marked as current "
                    f"({others.version_label}). Unmark it before marking this one."
                )

    def action_view_recipe_versions(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Versions of {self.product_tmpl_id.display_name}',
            'res_model': 'mrp.bom',
            'view_mode': 'tree,form',
            'domain': [('version_root_id', '=', self.version_root_id.id)],
            'context': {'default_version_root_id': self.version_root_id.id},
        }
