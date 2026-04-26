{
    "name": "Krawings BOM Auto Quantity",
    "version": "18.0.2.0.0",
    "category": "Manufacturing",
    "summary": "Auto-set BOM output qty to the sum of ingredient quantities",
    "description": """
        Keeps BOM output quantity equal to the sum of ingredient quantities.

        v2 (What a Jerk only, company_id=5):
        - BOM output quantity is read-only in the form view.
        - Direct writes to product_qty are blocked with a clear error.
        - Initial BOM creation triggers a sync of product_qty against lines.

        v1 (all companies):
        - On BOM line add/change/remove, parent BOM product_qty is
          recalculated as the sum of line quantities (same UoM category;
          mismatched UoM lines are silently skipped).

        Other companies (Ssam Korean BBQ, etc.) keep v1 behavior only —
        the lock and form-readonly only apply to What a Jerk BOMs.
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
