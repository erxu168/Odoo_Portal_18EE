{
    'name': 'Krawings Contract Manager',
    'version': '18.0.1.0.0',
    'category': 'Operations',
    'summary': 'Unified contract management with AI-powered document scanning',
    'description': """
        Manage all business contracts (rent, insurance, utilities, telecom,
        service, supplier) in one place, organized by location.

        Features:
        - Unified contract model with type-specific fields
        - Location-first organization (each location shows all its contracts)
        - Kuendigungsfrist tracking with automated alerts (90/60/30 days)
        - Auto-renewal detection and deadline calculation
        - Portal integration for AI-powered contract scanning
        - Document attachment support
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'depends': ['base', 'mail', 'contacts'],
    'data': [
        'security/ir.model.access.csv',
        'data/contract_data.xml',
        'views/contract_views.xml',
        'views/location_views.xml',
        'views/menu_views.xml',
    ],
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
