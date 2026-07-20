{
    "name": "Krawings - POS Person-First Login",
    "version": "18.0.1.0.0",
    "summary": "At POS cashier login, pick the person first, then enter their PIN "
    "(replaces the combined type-PIN-or-pick-person screen)",
    "description": """
When employee login (pos_hr) is enabled, the default POS unlock screen shows a
PIN field with a separate "pick a cashier" button, which is confusing.

This makes the flow person-first: tapping Open/Unlock Register opens the cashier
list first; after choosing a person, if they have a PIN it is requested on the
POS numpad (no on-screen/OS keyboard). Staff without a PIN are logged in on
selection, exactly as before. Badge/barcode login is unaffected.

Implementation: patches the core LoginScreen to route Open/Unlock Register
through the existing, tested selectCashier(list) path instead of showing the
PIN-first box. No new PIN-validation logic is introduced.
""",
    "author": "Krawings",
    "website": "https://krawings.de",
    "license": "LGPL-3",
    "category": "Point of Sale",
    "depends": ["pos_hr"],
    "assets": {
        "point_of_sale._assets_pos": [
            "krawings_pos_login_person_first/static/src/login_screen.js",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
