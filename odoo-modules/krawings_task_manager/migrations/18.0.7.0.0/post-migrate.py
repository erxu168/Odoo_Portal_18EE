"""18.0.7.0.0 — convert the legacy setup-guide into the new guided-tutorial.

The old "setup guide" stored reference photos (krawings.task.setup.photo) with
numbered pins as the line's SUBTASKS, and completed the task by ticking those
pins. Guided tutorials separate instruction from completion: pins become
krawings.task.guide.pin on photo krawings.task.guide.step records, and the task
is completed manually (see the model changes in this version).

Safety properties:
  - Idempotent: creation is guarded by existing guide_step_ids; cleanup and
    flagging are each independently idempotent; a revision is never lowered.
  - Non-destructive: a line is PREFLIGHTED and left completely untouched (for
    manual repair) if any setup photo lacks image bytes or any pin maps to no
    photo — so a pin's note/coords are never silently deleted.

Template lines (editable source): one photo step per setup photo (explanation
seeded from the task name — generic, so managers review), pins mapped by
pin_photo_seq; converted pin-subtasks are then DELETED (so they never spawn as
checklist items); the guide is marked published (it was live) and is_setup_guide
cleared. setup.photo rows are retained one release for rollback (spawn no longer
copies them, gated on is_setup_guide).

Daily list lines (immutable history): converted independently; the old
pin-subtasks are PRESERVED but marked legacy_guide_pin (audit — their
done/toggled_at history — excluded from the portal, non-toggleable);
completed_at is left exactly as it was (no completed task is reopened).
"""

import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def _convert(env, line, parent_key, mark_legacy_subtasks):
    """Convert one setup-guide line into guide steps + pins.

    Returns True on a clean (or already-done) conversion, False if the line was
    skipped for manual repair — in which case the caller must NOT clear
    is_setup_guide, so nothing is lost."""
    photos = line.setup_photo_ids.sorted('sequence')
    subs = line.subtask_ids.sorted('sequence')
    photo_seqs = set(photos.mapped('sequence'))

    # Preflight — refuse to touch the line unless everything maps cleanly.
    if any(not p.image for p in photos):
        _logger.warning('[krawings_task_manager] migration: %s=%s has a setup photo with no '
                        'image bytes — left as-is for manual repair', parent_key, line.id)
        return False
    if any(st.pin_photo_seq not in photo_seqs for st in subs):
        _logger.warning('[krawings_task_manager] migration: %s=%s has a pin mapping to no photo '
                        '— left as-is for manual repair', parent_key, line.id)
        return False

    Step = env['krawings.task.guide.step'].sudo()
    Pin = env['krawings.task.guide.pin'].sudo()
    if not line.guide_step_ids:  # create once — idempotent
        seq = 10
        for photo in photos:
            step = Step.create({
                parent_key: line.id,
                'sequence': seq,
                'media_type': 'photo',
                'explanation': line.name or 'Reference photo',
                'image': photo.image,
                'image_filename': photo.filename or False,
            })
            pin_seq = 10
            for st in subs:
                if st.pin_photo_seq == photo.sequence:
                    Pin.create({
                        'step_id': step.id,
                        'sequence': pin_seq,
                        'pin_x': st.pin_x or 0.0,
                        'pin_y': st.pin_y or 0.0,
                        'note': st.name or 'Note',
                    })
                    pin_seq += 10
            seq += 10

    # Cleanup — idempotent, only reached once the whole line mapped cleanly.
    if mark_legacy_subtasks:
        todo = subs.filtered(lambda s: not s.legacy_guide_pin)
        if todo:
            todo.write({'legacy_guide_pin': True})
    elif subs:
        subs.unlink()
    return True


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})

    tmpl = env['krawings.task.template.line'].search([('is_setup_guide', '=', True)])
    t_ok = 0
    for tl in tmpl:
        if not _convert(env, tl, 'template_line_id', mark_legacy_subtasks=False):
            continue
        tl.write({
            'is_setup_guide': False,
            'guide_published': True,
            'guide_revision': max(tl.guide_revision or 0, 1),  # never lower
        })
        t_ok += 1

    daily = env['krawings.task.list.line'].search([('is_setup_guide', '=', True)])
    d_ok = 0
    for ll in daily:
        if not _convert(env, ll, 'list_line_id', mark_legacy_subtasks=True):
            continue
        ll.write({
            'is_setup_guide': False,
            'guide_snapshot_revision': max(ll.guide_snapshot_revision or 0, 1),
        })
        d_ok += 1

    _logger.info(
        '[krawings_task_manager] guided-tutorial migration: converted %s/%s template guide(s), '
        '%s/%s daily guide(s); any skipped need manual repair',
        t_ok, len(tmpl), d_ok, len(daily),
    )
