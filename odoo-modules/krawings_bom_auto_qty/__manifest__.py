{
    "name": "Krawings BOM Auto Quantity",
    "version": "18.0.2.0.0",
    "category": "Manufacturing",
    "summary": "Auto-set BOM output qty to the sum of ingredient quantities",
    "description": """
Keeps BOM output quantity equal to the sum of ingredient quantities.
On BOM line add, change, or remove, the parent BOM product_qty is
recalculated as the sum of line quantities (same UoM category only;
mismatched UoM lines are silently skipped).

For What a Jerk (company_id=5) only: the output field is read-only in
the form view, and direct writes to product_qty are rejected with a
clear error. Other companies keep the editable behavior.
""",
    "author": "Krawings GmbH",
    "website": "https://krawings.de",
    "license": "LGPL-3",
    "depends": ["mrp"],
    "data": [
        "views/mrp_bom_views.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
