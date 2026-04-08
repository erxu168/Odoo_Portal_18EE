{
    "name": "Krawings POS Shift Report",
    "version": "18.0.1.0.0",
    "category": "Point of Sale",
    "summary": "Adds a mandatory shift report popup to POS Session closing",
    "description": "Prompts POS cashiers to fill out a shift report before closing the session.",
    "author": "Krawings",
    "website": "https://krawings.de",
    "depends": ["point_of_sale"],
    "data": [
        "views/pos_session_view.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "krawings_pos_closing_report/static/src/app/shift_report_popup/shift_report_popup.js",
            "krawings_pos_closing_report/static/src/app/shift_report_popup/shift_report_popup.xml",
            "krawings_pos_closing_report/static/src/override/point_of_sale/closing_popup.js",
        ],
    },
    "installable": True,
    "application": False,
    "license": "LGPL-3",
}
