"""18.0.4.0.0 — per-company configurable spawn time.

The spawn cron becomes hourly + self-healing: each pass creates lists only
for companies whose ``res.company.kw_task_spawn_hour`` (Europe/Berlin,
default 02:00) has been reached. ``data/cron.xml`` is ``noupdate="1"`` so
existing databases keep their old daily interval unless we flip it here.

The new ``kw_task_spawn_hour`` column itself needs no data migration — the
ORM adds it with its default (2) during the upgrade, before this script runs.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    # Also reset nextcall: the old daily schedule could postpone the first
    # hourly run by up to a day. Due-now is safe — the spawn pass is hour-
    # gated per company and idempotent.
    cr.execute(
        """
        UPDATE ir_cron c
           SET interval_number = 1,
               interval_type = 'hours',
               nextcall = (now() AT TIME ZONE 'UTC')
          FROM ir_model_data d
         WHERE d.model = 'ir.cron'
           AND d.res_id = c.id
           AND d.module = 'krawings_task_manager'
           AND d.name = 'ir_cron_spawn_daily_task_lists'
        """
    )
    if cr.rowcount == 0:
        _logger.error(
            '[krawings_task_manager] migration could not find the spawn cron '
            '(xmlid krawings_task_manager.ir_cron_spawn_daily_task_lists) — '
            'flip it to hourly manually or the per-company spawn hour will '
            'only take effect once a day'
        )
    else:
        _logger.info(
            '[krawings_task_manager] spawn cron flipped to hourly; effective '
            'spawn time now follows res.company.kw_task_spawn_hour'
        )
