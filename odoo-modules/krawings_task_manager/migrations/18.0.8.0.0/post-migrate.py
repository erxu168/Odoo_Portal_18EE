"""18.0.8.0.0 (post) — move each legacy per-task guide into a standalone,
reusable library guide (krawings.task.guide) and link its task to it.

Expand-migrate (the contract cleanup that drops the legacy columns is a later
18.0.9.0.0). Safety properties:

  - Steps are MOVED IN PLACE (guide_id set, template_line_id cleared) so their
    id is PRESERVED — every ir.attachment for a photo/pdf and every already
    spawned daily snapshot's source reference stays valid.
  - Each guide is created as a DRAFT via the ORM, its steps are moved under it,
    THEN published/revision are written — so every computed / related / stored
    field populates and the published⟹complete invariant actually validates the
    migrated result (an incomplete-but-published guide would abort the upgrade).
  - Daily snapshots are never rewritten except two AUDIT-ONLY backfills
    (source_guide_step_id, guide_source_id/name). A fingerprint of every daily
    snapshot's CONTENT and every daily task's COMPLETION is captured before and
    re-checked after; ANY drift raises → the whole upgrade rolls back.
  - Idempotent: a line that already has guide_id is skipped.
"""

import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def _daily_content(cr):
    """Content fingerprint of every daily-snapshot guide step — the data that
    must stay byte-for-byte identical across this migration. Includes the actual
    media BYTES (ir.attachment checksums for the image/pdf fields) so a swapped
    photo/PDF is caught, not just the filename. Source/audit refs are excluded —
    those are exactly what the migration backfills."""
    cr.execute("""
        SELECT s.id, s.list_line_id, s.sequence, s.media_type,
               s.explanation, s.image_filename, s.pdf_filename, s.youtube_url,
               (SELECT string_agg(a.checksum, ',' ORDER BY a.res_field, a.id)
                  FROM ir_attachment a
                 WHERE a.res_model = 'krawings.task.guide.step'
                   AND a.res_id = s.id
                   AND a.res_field IN ('image', 'pdf_file')) AS media_checksums
          FROM krawings_task_guide_step s
         WHERE s.list_line_id IS NOT NULL
         ORDER BY s.id
    """)
    return cr.fetchall()


def _daily_pins(cr):
    """Fingerprint of every note-pin on a daily-snapshot step — the pins' notes
    and coordinates must not move."""
    cr.execute("""
        SELECT p.id, p.step_id, p.sequence, p.pin_x, p.pin_y, p.note
          FROM krawings_task_guide_pin p
          JOIN krawings_task_guide_step s ON s.id = p.step_id
         WHERE s.list_line_id IS NOT NULL
         ORDER BY p.id
    """)
    return cr.fetchall()


def _daily_completion(cr):
    """Completion (who/when + denormalized name) + snapshot revision of every
    daily line that carries a guide — the migration must not reopen, complete,
    or re-version any of them."""
    cr.execute("""
        SELECT ll.id, ll.completed_at, ll.completed_by_id, ll.completed_by_name,
               ll.guide_snapshot_revision
          FROM krawings_task_list_line ll
         WHERE EXISTS (
             SELECT 1 FROM krawings_task_guide_step s WHERE s.list_line_id = ll.id
         )
         ORDER BY ll.id
    """)
    return cr.fetchall()


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})

    # Baselines captured BEFORE any change. Content columns on a daily step/line
    # are plain (not computed/related), so the schema-load phase between pre and
    # post cannot alter them — a post-start baseline is a faithful "before".
    base_content = _daily_content(cr)
    base_pins = _daily_pins(cr)
    base_completion = _daily_completion(cr)

    Guide = env['krawings.task.guide'].sudo()
    Line = env['krawings.task.template.line'].sudo()

    cr.execute("""
        SELECT template_line_id, company_id, line_name, published, revision
          FROM _kw_guide_mig_stash
    """)
    stash = cr.fetchall()

    moved_guides = 0
    moved_steps = 0
    for template_line_id, company_id, line_name, published, revision in stash:
        line = Line.browse(template_line_id)
        if not line.exists() or line.guide_id:
            continue  # gone, or already migrated (idempotent re-run)
        if not company_id:
            company_id = line.template_id.company_id.id
        if not company_id:
            _logger.error(
                "[krawings_task_manager] 18.0.8.0.0: template line %s has no "
                "company; guide left in place for manual repair", template_line_id,
            )
            continue
        # Create the library guide as a DRAFT (the invariant forbids an empty
        # published guide); seed name / company / revision.
        guide = Guide.create({
            'name': line_name or line.name or 'Guide',
            'company_id': company_id,
            'published': False,
            'revision': revision or 0,
        })
        # Move the editable steps IN PLACE — preserve their id.
        cr.execute("""
            UPDATE krawings_task_guide_step
               SET guide_id = %s, template_line_id = NULL
             WHERE template_line_id = %s
        """, (guide.id, template_line_id))
        moved_steps += cr.rowcount
        # The raw SQL move bypassed the ORM, so the guide's cached step_ids and
        # its STORED computed step_count/has_steps are stale. invalidate_recordset
        # only drops the cache; modified() schedules the actual recompute so the
        # end-of-migration flush writes the right counts (else the guide records
        # step_count=0 and every linked task reports "no guide"). Then set
        # published/revision (the invariant re-validates against the now-attached
        # steps) and link the task — which schedules its stored relateds
        # (guide_step_count/guide_published/…) + has_guide to recompute too.
        guide.invalidate_recordset()
        guide.modified(['step_ids'])
        guide.write({'published': bool(published), 'revision': revision or 0})
        line.guide_id = guide.id
        moved_guides += 1

    env.flush_all()      # process the scheduled recomputes → correct DB counts
    env.invalidate_all()

    # Audit-only backfills (content untouched):
    #   1. daily snapshot → library step traceability
    cr.execute("""
        UPDATE krawings_task_guide_step
           SET source_guide_step_id = source_template_step_id
         WHERE list_line_id IS NOT NULL
           AND source_template_step_id IS NOT NULL
           AND source_guide_step_id IS NULL
    """)
    #   2. daily line → the guide it was taken from (name survives later deletion)
    cr.execute("""
        UPDATE krawings_task_list_line ll
           SET guide_source_id = g.id,
               guide_source_name = g.name
          FROM krawings_task_guide_step ds
          JOIN krawings_task_guide_step src ON src.id = ds.source_guide_step_id
          JOIN krawings_task_guide g ON g.id = src.guide_id
         WHERE ds.list_line_id = ll.id
           AND ll.guide_source_id IS NULL
    """)

    # Verify — daily content (incl. media bytes), pins, and completion must all
    # be byte-for-byte identical; any drift aborts the whole upgrade.
    if _daily_content(cr) != base_content:
        raise Exception(
            "[krawings_task_manager] 18.0.8.0.0 ABORT: a daily guide snapshot's "
            "content or media changed during migration — rolling the whole upgrade back."
        )
    if _daily_pins(cr) != base_pins:
        raise Exception(
            "[krawings_task_manager] 18.0.8.0.0 ABORT: a daily guide snapshot's "
            "note-pins changed during migration — rolling the whole upgrade back."
        )
    if _daily_completion(cr) != base_completion:
        raise Exception(
            "[krawings_task_manager] 18.0.8.0.0 ABORT: a daily task's completion "
            "changed during migration — rolling the whole upgrade back."
        )

    cr.execute("DROP TABLE IF EXISTS _kw_guide_mig_stash")
    _logger.info(
        "[krawings_task_manager] 18.0.8.0.0: moved %s per-task guide(s) into the "
        "library (%s step(s)); daily snapshots verified unchanged.",
        moved_guides, moved_steps,
    )
