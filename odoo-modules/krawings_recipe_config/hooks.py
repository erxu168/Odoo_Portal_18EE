import logging

_logger = logging.getLogger(__name__)


def post_init_backfill_version_root(env):
    """For every existing mrp.bom with no version_root_id, set it to
    its own id. Each existing BOM becomes the root of its own
    one-version chain. Safe to re-run."""
    env.cr.execute("""
        UPDATE mrp_bom
           SET version_root_id = id
         WHERE version_root_id IS NULL
    """)
    n = env.cr.rowcount
    _logger.info("krawings_recipe_config: backfilled version_root_id for %s BOM(s)", n)
