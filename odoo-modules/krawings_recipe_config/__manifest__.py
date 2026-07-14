{
    'name': 'Krawings Recipe Config',
    'version': '18.0.3.0.0',
    'category': 'Manufacturing',
    'summary': 'Recipe Guide data layer + BOM versioning for Krawings Portal PWA',
    'description': """
        Adds recipe guide fields and BOM ingredient-version chaining to
        support the Krawings Portal Manufacturing module.
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['product', 'mrp', 'stock'],
    'data': [
        'security/ir.model.access.csv',
        'views/recipe_category_views.xml',
        'views/recipe_step_views.xml',
        'views/product_template_views.xml',
        'views/mrp_bom_views.xml',
        'views/menu.xml',
    ],
    'post_init_hook': 'post_init_backfill_version_root',
    'installable': True,
    'application': False,
    'auto_install': False,
}
