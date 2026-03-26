{
    'name': 'Krawings Recipe Config',
    'version': '18.0.2.0.0',
    'category': 'Manufacturing',
    'summary': 'Recipe Guide data layer for Krawings Portal PWA',
    'description': """
        Adds recipe guide fields and models to support the Krawings
        Portal Recipe Guide module. Creates:
        - Recipe categories with location mapping
        - Cooking steps with images and versioning
        - Recording sessions for field capture
        - Custom fields on product.template and mrp.bom
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
    'installable': True,
    'application': False,
    'auto_install': False,
}
