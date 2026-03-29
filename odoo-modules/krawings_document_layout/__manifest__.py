{
    "name": "Krawings Document Layout",
    "summary": "Clean, minimal letterhead for all Krawings companies. "
               "Adaptive footer shows only fields that have data.",
    "author": "Krawings GmbH",
    "category": "Base",
    "version": "18.0.1.0.1",
    "depends": ["base", "web", "l10n_din5008"],
    "data": [
        "data/paper_format.xml",
        "views/report_templates.xml",
        "data/report_layout.xml",
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
