"""18.0.2.0.0 — switch from template-level day-of-week scheduling to per-task
recurrence rules. The user explicitly chose a hard reset (option B in the
brainstorm) since the live data is small (1 template, 6 tasks).

We:
  - drop the day_mon..day_sun columns from krawings_task_template
  - wipe all template / template-line / template-subtask rows so the new
    recurrence fields have valid defaults on the rebuilt records
  - leave krawings_task_list, .line, .subtask, and ir.attachment rows in
    place (history of completed tasks survives; source_template_line_id
    becomes orphaned, which the model already handles via ondelete=set null)
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return

    _logger.info('[krawings_task_manager] hard-reset migration to 18.0.2.0.0')

    # Drop the legacy day-of-week columns. The Python model no longer
    # declares them; without this, the next ORM init would still see them
    # as NOT NULL leftovers in the table.
    for col in ('day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun'):
        cr.execute(
            "ALTER TABLE krawings_task_template DROP COLUMN IF EXISTS %s" % col
        )

    # Hard reset of templates / lines / subtasks. Cascades through the FKs
    # take care of subtasks and the now-removed exception table.
    cr.execute("DELETE FROM krawings_task_template_subtask")
    cr.execute("DELETE FROM krawings_task_template_line")
    cr.execute("DELETE FROM krawings_task_template")

    # Decouple any previously-spawned list lines from their (now-deleted)
    # source template lines so history reads cleanly.
    cr.execute(
        "UPDATE krawings_task_list_line SET source_template_line_id = NULL "
        "WHERE source_template_line_id IS NOT NULL"
    )

    _logger.info('[krawings_task_manager] hard reset complete; rebuild templates in the portal')
