{
    'name': 'Krawings Shift Self-Service',
    'version': '18.0.1.0.0',
    'category': 'Human Resources/Planning',
    'summary': 'Custom fields backing the Krawings Portal shift '
               'self-service and auto-scheduling modules',
    'description': """
Krawings Shift Self-Service
============================
Adds the data-model foundation used by the Krawings Portal (Next.js)
shift self-service module and the phase-2 CP-SAT auto-scheduler. All
staff-facing and manager-facing UI lives in the portal; this addon only
defines the fields the portal reads and writes over JSON-RPC.

Extended fields on hr.employee:
- x_max_weekly_hours: SOFT per-employee weekly hour cap (ISO week Mon-Sun)
- x_skill_level: capability tier (1 cannot work alone / 2 can work alone /
  3 can work alone + all tasks)

Extended fields on planning.slot:
- x_over_cap_flag: stored flag set by the portal when a claim/assignment
  pushes the employee over their weekly cap

No views are shipped: the portal is the sole interface. Fields are exposed
in the Odoo backend form via standard inheritance only if needed later.
""",
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'depends': ['hr', 'planning'],
    'data': [],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
