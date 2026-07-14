from odoo import models, fields, api


class KrawingsRecipeVersion(models.Model):
    _name = 'krawings.recipe.version'
    _description = 'Recipe Guide Version'
    _order = 'create_date desc'

    product_tmpl_id = fields.Many2one(
        'product.template', string='Product',
        ondelete='cascade', index=True,
    )
    bom_id = fields.Many2one(
        'mrp.bom', string='Bill of Materials',
        ondelete='cascade', index=True,
    )
    version = fields.Integer(string='Version Number', default=1)
    status = fields.Selection([
        ('draft', 'Draft'),
        ('review', 'Pending Review'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ], string='Status', default='draft', required=True, index=True)
    change_summary = fields.Text(string='Change Summary')
    created_by_id = fields.Many2one(
        'res.users', string='Submitted By',
        default=lambda self: self.env.uid,
    )
    approved_by_id = fields.Many2one(
        'res.users', string='Approved By',
    )
    approved_at = fields.Datetime(string='Approved At')
    rejection_reason = fields.Text(string='Rejection Reason')
    step_ids = fields.One2many(
        'krawings.recipe.step', 'version_id',
        string='Steps in this version',
    )
