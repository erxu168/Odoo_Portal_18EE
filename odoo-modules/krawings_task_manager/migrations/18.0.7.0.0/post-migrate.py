"""18.0.7.0.0 — convert the legacy setup-guide into the new guided-tutorial.

The old "setup guide" stored one-or-more reference photos (krawings.task.setup.photo)
with numbered pins as the line's SUBTASKS, and completed the task by ticking those
pins. Guided tutorials separate instruction from completion: pins become
krawings.task.guide.pin on photo krawings.task.guide.step records, and the task is
completed manually (see the model changes in this version).

This migration is idempotent (guarded by is_setup_guide + existing guide_step_ids):

Template lines (editable source):
  - one photo guide step per setup photo (explanation seeded from the task name —
    flagged for manager review by being generic), pins mapped by pin_photo_seq;
  - the converted pin-subtasks are DELETED (so they never spawn as checklist items);
  - the guide is marked published (it was live) and is_setup_guide cleared;
  - setup.photo rows are retained for one release for rollback (the spawn no longer
    copies them, gated on is_setup_guide).

Daily list lines (immutable history):
  - converted independently (they are historical snapshots, not driven by the template);
  - the old pin-subtasks are PRESERVED but marked legacy_guide_pin (kept for audit —
    their done/toggled_at history — excluded from the portal, no longer toggleable);
  - completed_at is left exactly as it was (no completed task is reopened).

A setup photo with pins but no image bytes is logged for manual repair rather than
silently producing a broken step.
"""

import logging

from odoo import api, SUPERUSER_ID

_logger = logging.getLogger(__name__)


def _convert(env, line, parent_key, mark_legacy_subtasks):
    """Build guide steps + pins for one setup-guide line. Returns steps created."""
    if line.guide_step_ids:
        return 0  # already converted — idempotent
    Step = env['krawings.task.guide.step'].sudo()
    Pin = env['krawings.task.guide.pin'].sudo()
    subs = line.subtask_ids.sorted('sequence')
    made = 0
    seq = 10
    for photo in line.setup_photo_ids.sorted('sequence'):
        if not photo.image:
            _logger.warning(
                '[krawings_task_manager] migration: setup photo id=%s on %s=%s has no '
                'image bytes — skipped; manager should re-add it',
                photo.id, parent_key, line.id,
            )
            continue
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
        made += 1
    if mark_legacy_subtasks:
        if subs:
            subs.write({'legacy_guide_pin': True})   # preserve daily audit
    else:
        subs.unlink()                                 # template pins → deleted
    return made


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})

    tmpl = env['krawings.task.template.line'].search([('is_setup_guide', '=', True)])
    t_steps = 0
    for tl in tmpl:
        t_steps += _convert(env, tl, 'template_line_id', mark_legacy_subtasks=False)
        tl.write({'is_setup_guide': False, 'guide_published': True, 'guide_revision': 1})

    daily = env['krawings.task.list.line'].search([('is_setup_guide', '=', True)])
    d_steps = 0
    for ll in daily:
        d_steps += _convert(env, ll, 'list_line_id', mark_legacy_subtasks=True)
        # completed_at intentionally untouched; is_setup_guide cleared.
        ll.write({'is_setup_guide': False, 'guide_snapshot_revision': 1})

    _logger.info(
        '[krawings_task_manager] guided-tutorial migration complete: '
        '%s template guide(s) → %s steps; %s daily guide(s) → %s steps',
        len(tmpl), t_steps, len(daily), d_steps,
    )
