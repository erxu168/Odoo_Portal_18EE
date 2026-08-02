"""18.0.8.0.0 (pre) — stash authoritative per-task guide state before the
guide-library re-architecture.

In this version the template line's guide_published / guide_revision become
STORED RELATEDS through the new guide_id link, and the guide's steps move onto a
standalone krawings.task.guide. Capture the authoritative published/revision NOW,
while the old columns still hold them, so the post step can seed each new library
guide correctly regardless of when Odoo recomputes those related columns during
the schema load. Keyed by the template line that currently owns guide steps."""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not version:
        return
    cr.execute("DROP TABLE IF EXISTS _kw_guide_mig_stash")
    cr.execute("""
        CREATE TABLE _kw_guide_mig_stash (
            template_line_id integer PRIMARY KEY,
            company_id integer,
            line_name varchar,
            published boolean,
            revision integer
        )
    """)
    cr.execute("""
        INSERT INTO _kw_guide_mig_stash
            (template_line_id, company_id, line_name, published, revision)
        SELECT DISTINCT tl.id, t.company_id, tl.name,
               COALESCE(tl.guide_published, false), COALESCE(tl.guide_revision, 0)
          FROM krawings_task_template_line tl
          JOIN krawings_task_template t ON t.id = tl.template_id
         WHERE EXISTS (
             SELECT 1 FROM krawings_task_guide_step s
              WHERE s.template_line_id = tl.id
         )
    """)
    cr.execute("SELECT count(*) FROM _kw_guide_mig_stash")
    n = cr.fetchone()[0]
    _logger.info(
        "[krawings_task_manager] 18.0.8.0.0 pre: stashed %s per-task guide(s) "
        "for the library migration", n,
    )
