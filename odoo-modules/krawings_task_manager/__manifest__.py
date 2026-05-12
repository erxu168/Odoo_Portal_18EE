{
    'name': 'Krawings Task Manager',
    'version': '18.0.3.0.0',
    'category': 'Human Resources',
    'summary': 'Department-based daily task lists for Krawings Portal PWA',
    'description': """
Department Task Manager
=======================

Recurring daily task lists scoped per hr.department.

Templates:
  - One template per (department, day-of-week combination)
  - Tasks grouped by day-part (opening / mid-day / closing)
  - Deadlines as time-of-day, photo evidence flag, optional module link

Daily instances:
  - Spawned by cron at 00:05 from any template whose day-of-week matches
  - Anyone in the department can complete any task
  - Manager can add ad-hoc one-off tasks to today's instance
  - Past instances are immutable history
    """,
    'author': 'Krawings GmbH',
    'website': 'https://krawings.de',
    'license': 'LGPL-3',
    'depends': ['hr', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'security/krawings_task_manager_security.xml',
        'data/cron.xml',
        'views/task_template_views.xml',
        'views/task_list_views.xml',
        'views/menu.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
