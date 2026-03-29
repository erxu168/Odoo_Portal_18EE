{
    "name": "Krawings Document Layout",
    "summary": "Clean, minimal letterhead. Inherits DIN 5008 and overrides "
               "header + footer styling. Adaptive footer shows only "
               "fields that have data.",
    "author": "Krawings GmbH",
    "category": "Base",
    "version": "18.0.2.0.0",
    "depends": ["l10n_din5008"],
    "data": [
        "views/report_templates.xml",
    ],
    "assets": {
        "web.report_assets_common": [
            "krawings_document_layout/static/src/scss/layout_krawings.scss",
        ],
    },
    "installable": True,
    "application": False,
    "license": "LGPL-3",
}
