{
    "name": "Krawings Document Layout",
    "summary": "Letterhead via background image. Hides DIN 5008 header/footer "
               "since the letterhead background already contains them.",
    "author": "Krawings GmbH",
    "category": "Base",
    "version": "18.0.3.0.0",
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
