{
    "name": "Krawings - BOM Auto Quantity",
    "version": "18.0.4.0.0",
    "summary": "Lock mrp.bom.product_qty and auto-compute as sum of ingredient line weights",
    "description": """
Forces mrp.bom.product_qty to equal SUM(bom_line_ids.product_qty)
on every line edit, and rejects any manual product_qty write with
a UserError. Applied to ALL companies (Krawings, Ssam KBQ, What a Jerk).

Pre v18.0.4.0.0: scope was company_id=5 (What a Jerk) only.
v18.0.4.0.0: expanded to all three companies, no company filter.

Migration on install: aligns every existing BOM where qty != sum.
""",
    "author": "Krawings",
    "license": "LGPL-3",
    "category": "Manufacturing",
    "depends": ["mrp"],
    "data": [
        "views/mrp_bom_views.xml",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
