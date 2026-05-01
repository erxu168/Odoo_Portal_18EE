"""
Post-migration for v18.0.4.0.0.

One-shot: align mrp.bom.product_qty = SUM(mrp.bom.line.product_qty) for every
BOM that has at least one line, across all companies. Done in raw SQL because
this runs once at install/upgrade time and we want to bypass the new write()
guard cleanly without context juggling.

Empty BOMs (no lines) are left alone.
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        WITH sums AS (
            SELECT bom_id, SUM(product_qty) AS total_qty
            FROM mrp_bom_line
            GROUP BY bom_id
        )
        UPDATE mrp_bom mb
           SET product_qty = sums.total_qty
          FROM sums
         WHERE mb.id = sums.bom_id
           AND sums.total_qty > 0
           AND ABS(mb.product_qty - sums.total_qty) > 0.0001
        RETURNING mb.id;
    """)
    updated = cr.fetchall()
    _logger.info(
        "krawings_bom_auto_qty 18.0.4.0.0: realigned product_qty on %d BOM(s)",
        len(updated),
    )
