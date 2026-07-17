{
    "name": "Krawings - POS Cash Count (coins by value, no OS keyboard)",
    "version": "18.0.1.0.0",
    "summary": "Count coins by value or quantity at register closing, with an "
    "on-screen numpad and no Android soft-keyboard popup",
    "description": """
Improves the cash-counting step of the POS register closing:

* Each denomination flagged as a coin can be counted by QUANTITY or by total
  VALUE (e.g. type "4.50" of 5-cent coins instead of counting 90 coins).
  Notes/bills stay quantity-only.
* An on-screen numpad is embedded in the count popup and the native
  (Android) keyboard is suppressed for the numeric fields, so it never
  occludes the popup on tablet tills. The +/- buttons keep working.

Phase 1: scoped to the closing cash-count popup (MoneyDetailsPopup).
""",
    "author": "Krawings",
    "website": "https://krawings.de",
    "license": "LGPL-3",
    "category": "Point of Sale",
    "depends": ["point_of_sale"],
    "data": [
        "views/pos_bill_views.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "krawings_pos_cash_count/static/src/overrides/money_details_popup.js",
            "krawings_pos_cash_count/static/src/overrides/money_details_popup.xml",
            "krawings_pos_cash_count/static/src/overrides/money_details_popup.scss",
        ],
    },
    "post_init_hook": "_set_default_coin_flags",
    "installable": True,
    "application": False,
    "auto_install": False,
}
