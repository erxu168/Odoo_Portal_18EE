import logging
from datetime import datetime, time

import psycopg2
import pytz

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .recurrence import applies_on, rule_from_record

_logger = logging.getLogger(__name__)

# Business timezone for all task scheduling. Deliberately fixed rather than
# derived from the server / cron user / RPC context, so spawn timing and
# deadline conversion cannot drift when any of those run in UTC.
BERLIN_TZ = pytz.timezone('Europe/Berlin')


def _guide_pub(tline):
    """True when a task links a PUBLISHED, non-empty library guide worth
    snapshotting onto the day's line. Drafts / empty / unlinked → no snapshot."""
    g = tline.guide_id
    return bool(g and g.published and g.step_ids)


class KrawingsTaskTemplate(models.Model):
    _name = 'krawings.task.template'
    _description = 'Department Task Template'
    _order = 'department_id, name'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    department_id = fields.Many2one(
        'hr.department', required=True, ondelete='cascade', index=True,
    )
    company_id = fields.Many2one(
        'res.company', related='department_id.company_id', store=True, index=True,
    )

    line_ids = fields.One2many(
        'krawings.task.template.line', 'template_id', string='Tasks', copy=True,
    )
    line_count = fields.Integer(compute='_compute_line_count')

    @api.depends('line_ids')
    def _compute_line_count(self):
        for tpl in self:
            tpl.line_count = len(tpl.line_ids)

    @api.model
    def spawn_today_lists(self):
        """Public RPC entry: spawn today's lists for every department. Safe to
        call from the portal (manager Spawn button). Idempotent — calling
        again does not duplicate today's lists. A manual click means "spawn
        now", so the per-company spawn hour is ignored."""
        return self._spawn_daily_task_lists(force=True)

    @api.model
    def _cron_spawn_daily_task_lists(self):
        """Cron entry (runs hourly): spawn today's lists for every department
        whose company's configured spawn hour (Europe/Berlin) has been
        reached. Hourly + idempotent makes this self-healing — a run missed
        while the server was down is caught up on the next pass, and DST
        shifts need no special handling because the gate is evaluated in
        local time. sudo() so an internal scheduled job covers every
        restaurant regardless of the cron user's company context."""
        return self.sudo()._spawn_daily_task_lists(force=False)

    @api.model
    def _berlin_now(self):
        """Current wall-clock time in the business timezone (Europe/Berlin)."""
        return fields.Datetime.now().replace(tzinfo=pytz.UTC).astimezone(BERLIN_TZ)

    @api.model
    def _spawn_daily_task_lists(self, force=False):
        """Spawn today's (Europe/Berlin) lists for every department that has
        at least one active template. With force=False, a department is only
        processed once local time has reached its company's
        ``kw_task_spawn_hour`` (default 2 = 02:00)."""
        berlin_now = self._berlin_now()
        today = berlin_now.date()
        TaskList = self.env['krawings.task.list']
        # Group by department to avoid spawning the same list twice when a
        # department has multiple active templates.
        depts = self.env['hr.department']
        for tpl in self.search([('active', '=', True)]):
            depts |= tpl.department_id
        # One batched query for today's existing lists instead of one per
        # department on every hourly pass.
        have_today = {
            rec['department_id'][0]
            for rec in TaskList.search_read([('date', '=', today)], ['department_id'])
            if rec.get('department_id')
        }
        spawned = 0
        skipped = 0
        waiting = 0
        for dept in depts:
            if not force:
                if not dept.company_id:
                    _logger.warning(
                        '[krawings_task_manager] department %s (%s) has no company; '
                        'using default spawn hour 2 — fix the department assignment',
                        dept.id, dept.name,
                    )
                # Integer field: an unset value reads as 0, which is a valid
                # hour (midnight) — only a missing company falls back to 2.
                spawn_hour = dept.company_id.kw_task_spawn_hour if dept.company_id else 2
                if berlin_now.hour < spawn_hour:
                    waiting += 1
                    continue
            if dept.id in have_today:
                skipped += 1
                continue
            new_list = self._build_list_for_dept_date(dept, today)
            if new_list:
                spawned += 1
        _logger.info(
            '[krawings_task_manager] spawn pass complete (%s): %s spawned, %s already existed, %s before spawn hour',
            'manual' if force else 'cron', spawned, skipped, waiting,
        )

    @api.model
    def _build_list_for_dept_date(self, department, target_date):
        """Materialise a krawings.task.list for (department, date) by iterating
        every active template's lines and asking the recurrence engine which
        ones fire on that date. Returns the new list record, or False if the
        list already exists or no lines fire."""
        TaskList = self.env['krawings.task.list']
        TaskTemplate = self.env['krawings.task.template']
        existing = TaskList.search([
            ('date', '=', target_date),
            ('department_id', '=', department.id),
        ], limit=1)
        if existing:
            return False

        templates = TaskTemplate.search([
            ('active', '=', True),
            ('department_id', '=', department.id),
        ])
        # Fixed business timezone: deadline times entered on template lines
        # mean Berlin wall-clock, regardless of which user's context (cron
        # user, portal service account, …) executes the spawn.
        tz = BERLIN_TZ

        line_vals = []
        chosen_template = None
        for tpl in templates:
            for tline in tpl.line_ids:
                if not applies_on(rule_from_record(tline), target_date):
                    continue
                line_vals.append((0, 0, self._line_snapshot_vals(tline, target_date, tz)))
                if chosen_template is None:
                    chosen_template = tpl

        # Even if no lines fire we still create an empty list so manager
        # ad-hoc additions and "no list yet" UX have a record to attach to.
        # The savepoint makes the check-then-create genuinely idempotent
        # under concurrency: if the hourly cron and the portal's manual
        # Spawn button race, the loser hits the uniq_date_department
        # constraint and treats it as "already exists".
        try:
            with self.env.cr.savepoint():
                return TaskList.create({
                    'date': target_date,
                    'department_id': department.id,
                    'template_id': chosen_template.id if chosen_template else False,
                    'line_ids': line_vals,
                })
        except psycopg2.IntegrityError:
            _logger.info(
                '[krawings_task_manager] concurrent spawn for dept %s on %s — '
                'another worker created the list first',
                department.id, target_date,
            )
            return False

    def _spawn_for_date(self, target_date):
        """Compatibility helper retained for callers that still expect a
        per-template spawn entry-point. Internally delegates to the
        department-level builder so all active templates contribute."""
        self.ensure_one()
        return self._build_list_for_dept_date(self.department_id, target_date)

    def action_spawn_today(self):
        """Manual trigger from form view."""
        today = self._berlin_now().date()
        any_spawned = False
        for tpl in self:
            if self._build_list_for_dept_date(tpl.department_id, today):
                any_spawned = True
        if not any_spawned:
            raise UserError('No new list spawned (already exists for this department).')
        return True


    @api.model
    def _line_snapshot_vals(self, tline, target_date, tz):
        """The daily snapshot of ONE template line, as create() values.

        Extracted from _build_list_for_dept_date so the nightly spawn and the
        manager's "add this task to today's list too" build a daily line through
        the SAME code. A second copy of ~70 lines of snapshot rules (guide steps,
        pins, setup photos, drawings, the deadline carry/clamp) would drift the
        first time either side gained a field — and the drift would be silent.
        """
        deadline_dt = False
        deadline_implicit = False
        due_hours = tline.deadline_time
        if not due_hours:
            # No time of its own → due when its PERIOD ends. Opening/Service/
            # Closing were labels with no time attached, which is exactly why a
            # task without a deadline could never be called late or remind
            # anyone. windows_for returns {} until the restaurant has set its
            # service times, and then nothing changes — no invented deadlines.
            windows = self.env['krawings.task.service.day'].windows_for(
                tline.template_id.department_id.company_id.id, target_date,
            )
            window = windows.get(tline.day_part)
            if window:
                due_hours = window[1]
                deadline_implicit = True
        if due_hours:
            hours = int(due_hours)
            minutes = int(round((due_hours - hours) * 60))
            # A Float like 7.9999 rounds minutes to 60 → time(h, 60) raises
            # ValueError and (being outside the savepoint) would abort the
            # whole department's spawn pass. Carry/clamp into a valid time.
            if minutes >= 60:
                hours += 1
                minutes = 0
            if hours >= 24:
                hours, minutes = 23, 59
            local_dt = tz.localize(datetime.combine(target_date, time(hours, minutes)))
            deadline_dt = local_dt.astimezone(pytz.UTC).replace(tzinfo=None)
        return {
            'deadline_is_implicit': deadline_implicit,
            'name': tline.name,
            'sequence': tline.sequence,
            'day_part': tline.day_part,
            'deadline_datetime': deadline_dt,
            'photo_required': tline.photo_required,
            'photo_instructions': tline.photo_instructions or False,
            'manager_note': tline.manager_note or False,
            'module_link_type': tline.module_link_type,
            'is_ad_hoc': False,
            'source_template_line_id': tline.id,
            # Setup-guide snapshot (D4): each daily line keeps its own copy
            # of every reference photo + the pins; photo sequences are
            # preserved so pin_photo_seq needs no remapping. The
            # filestore checksum-dedupes identical photo bytes.
            'is_setup_guide': tline.is_setup_guide,
            # Legacy setup-guide snapshot — only for lines still flagged
            # is_setup_guide. After the 18.0.7.0.0 migration converts a
            # guide (is_setup_guide→false), its retained template photos
            # are NOT re-copied; the guided-tutorial snapshot below takes over.
            'setup_photo_ids': ([
                (0, 0, {
                    'sequence': p.sequence,
                    'image': p.image,
                    'filename': p.filename or False,
                })
                for p in tline.setup_photo_ids
            ] if tline.is_setup_guide else []),
            **self._guide_snapshot_vals(tline),
            'subtask_ids': [
                (0, 0, {
                    'name': st.name,
                    'sequence': st.sequence,
                    'pin_photo_seq': st.pin_photo_seq,
                    'pin_x': st.pin_x,
                    'pin_y': st.pin_y,
                    # The subtask's own reference photo + its drawn marks, copied
                    # like everything else so the day is a frozen record. The
                    # filestore checksum-dedupes identical bytes, so a photo that
                    # does not change costs one row per day, not one image.
                    'image': st.image,
                    'image_filename': st.image_filename or False,
                    'drawings': st.drawings or False,
                })
                for st in tline.subtask_ids
            ],
        }


    @api.model
    def _guide_snapshot_vals(self, tline):
        """Just the guided-tutorial part of a daily line's snapshot.

        Split out of _line_snapshot_vals so the nightly spawn AND the manager's
        "refresh this task's guide" produce a byte-identical copy. Refresh
        replaces a live line's steps with this, so any divergence between the
        two would mean a refreshed task quietly differing from the same task
        spawned at 02:00.
        """
        return {
            # Guided-tutorial snapshot: only a PUBLISHED linked guide is
            # copied onto the daily line (drafts stay invisible to staff).
            # Deep copy of every step + its note-pins; filestore checksum-
            # dedupes identical image/pdf bytes. Purely instructional.
            # guide_source_id/name are audit only — playback reads the
            # list-owned snapshot below, never the live guide.
            'guide_snapshot_revision': (
                tline.guide_id.revision if _guide_pub(tline) else 0
            ),
            'guide_source_id': tline.guide_id.id if _guide_pub(tline) else False,
            'guide_source_name': tline.guide_id.name if _guide_pub(tline) else False,
            'guide_step_ids': ([
                (0, 0, {
                    'sequence': s.sequence,
                    'media_type': s.media_type,
                    'explanation': s.explanation,
                    'image': s.image,
                    'image_filename': s.image_filename or False,
                    'pdf_file': s.pdf_file,
                    'pdf_filename': s.pdf_filename or False,
                    'youtube_url': s.youtube_url or False,
                    'drawings': s.drawings or False,
                    'source_guide_step_id': s.id,
                    'pin_ids': [
                        (0, 0, {
                            'sequence': pin.sequence,
                            'pin_x': pin.pin_x,
                            'pin_y': pin.pin_y,
                            'note': pin.note,
                        })
                        for pin in s.pin_ids.sorted('sequence')
                    ],
                })
                for s in tline.guide_id.step_ids.sorted('sequence')
            ] if _guide_pub(tline) else [])
        }

    @api.model
    def _today_list_lines_for_template(self, tpl):
        """Today's daily lines that came from THIS template, by template line id."""
        today = self._berlin_now().date()
        task_list = self.env['krawings.task.list'].sudo().search([
            ('date', '=', today),
            ('department_id', '=', tpl.department_id.id),
        ], limit=1)
        if not task_list:
            return {}
        out = {}
        for line in task_list.line_ids:
            if line.source_template_line_id:
                out[line.source_template_line_id.id] = line
        return out

    @api.model
    def portal_today_guide_status(self, template_id):
        """Per task: is its copy on TODAY's list out of step with the library guide?

        One call for the whole template, so the editor can badge each row without
        a request per task. Read-only.

        `stale` is true when today's line would get a DIFFERENT guide if it were
        spawned now — the usual case being a guide published after 02:00, which
        is exactly the confusion this answers ("I published it, why doesn't the
        task show it?"). Comparing the stored revision also catches a guide that
        was merely edited.
        """
        tpl = self.sudo().browse(int(template_id))
        if not tpl.exists():
            return {}
        by_line = self._today_list_lines_for_template(tpl)
        out = {}
        for tline in tpl.line_ids:
            live = by_line.get(tline.id)
            if not live:
                continue                       # not on today's list at all
            wanted_rev = tline.guide_id.revision if _guide_pub(tline) else 0
            # Compare WHICH guide too, not just its revision: swapping a task to
            # a different guide that happens to sit at the same revision number
            # would otherwise look perfectly up to date. This is the exact
            # expression _guide_snapshot_vals writes, so a refresh clears it.
            wanted_src = tline.guide_id.id if _guide_pub(tline) else False
            has_now = bool(live.guide_step_ids)
            should_have = bool(_guide_pub(tline))
            stale = (
                has_now != should_have
                or live.guide_snapshot_revision != wanted_rev
                or (live.guide_source_id.id or False) != wanted_src
            )
            out[str(tline.id)] = {
                'on_today': True,
                'stale': stale,
                'has_guide_today': has_now,
                'guide_published': should_have,
            }
        return out

    @api.model
    def portal_refresh_today_guide(self, template_line_id):
        """Re-copy the library guide onto this task's line on TODAY's list.

        Deliberately TODAY ONLY. A past day's list is the record of what staff
        were actually shown that morning; rewriting it would falsify history.

        Fail-closed and guarded, in this order:
          1. the task must be on today's list,
          2. the guide must be PUBLISHED with steps.
        Only then are the old snapshot steps removed — never delete before you
        can recreate. Both happen in one RPC, so one transaction: a failure
        anywhere rolls the whole thing back and the line keeps the copy it had.

        Staff progress is untouched: completion, proof photos and subtasks live
        on the line, not on the guide snapshot.
        """
        Line = self.env['krawings.task.template.line'].sudo()
        tline = Line.browse(int(template_line_id))
        if not tline.exists():
            return {'refreshed': False, 'reason': 'no_line'}

        tpl = tline.template_id
        live = self._today_list_lines_for_template(tpl).get(tline.id)
        if not live:
            return {'refreshed': False, 'reason': 'not_on_today'}
        if not _guide_pub(tline):
            # Refusing rather than clearing: silently stripping a guide staff may
            # be halfway through is a worse surprise than doing nothing.
            return {'refreshed': False, 'reason': 'guide_not_published'}
        if live.completed_at:
            # The snapshot on a FINISHED task is the only record of what that
            # staff member was actually shown while doing it. Same reason past
            # days are off limits: do not rewrite the evidence after the fact.
            return {'refreshed': False, 'reason': 'already_done'}

        vals = self._guide_snapshot_vals(tline)
        try:
            with self.env.cr.savepoint():
                live.guide_step_ids.unlink()
                live.write(vals)
        except psycopg2.IntegrityError:
            # Two managers tapped at once: the other transaction already replaced
            # these steps, and our INSERT collides with uniq_list_seq. The work is
            # done either way — report it instead of surfacing a raw constraint
            # error, and the savepoint leaves the winner's snapshot intact.
            _logger.info(
                '[krawings_task_manager] concurrent guide refresh on list line %s — '
                'another request won', live.id,
            )
            return {'refreshed': False, 'reason': 'busy'}
        _logger.info(
            '[krawings_task_manager] refreshed guide snapshot on list line %s '
            'from template line %s (guide %s rev %s)',
            live.id, tline.id, tline.guide_id.id, tline.guide_id.revision,
        )
        return {'refreshed': True, 'reason': ''}

    @api.model
    def _today_line_context(self, template_line_id):
        """Shared lookup behind both today's-list calls: the line, its
        department's list for today, and whether the line may be added.

        Returns (line, task_list, reason). `reason` is None when it CAN be
        added; otherwise it says why not, and both callers report the same
        thing — the prompt never offers something the write would refuse.
        """
        Line = self.env['krawings.task.template.line'].sudo()
        line = Line.browse(int(template_line_id))
        if not line.exists():
            return line, False, 'no_line'

        department = line.template_id.department_id
        if not department:
            return line, False, 'no_department'

        today = self._berlin_now().date()
        task_list = self.env['krawings.task.list'].sudo().search([
            ('date', '=', today),
            ('department_id', '=', department.id),
        ], limit=1)
        if not task_list:
            # Nothing spawned yet today, so there is nothing to top up: the
            # normal spawn will include this task when it builds the list.
            return line, False, 'no_list_today'

        # Respect the task's OWN schedule. Adding a "Mondays only" task to a
        # Wednesday list would put it on a day it is not supposed to run.
        if not applies_on(rule_from_record(line), today):
            return line, task_list, 'not_due_today'

        already = self.env['krawings.task.list.line'].sudo().search_count([
            ('list_id', '=', task_list.id),
            ('source_template_line_id', '=', line.id),
        ])
        if already:
            return line, task_list, 'already_on_list'

        return line, task_list, None

    @api.model
    def portal_today_line_status(self, template_line_id):
        """Can this template line still be added to today's list? Read-only.

        The portal asks this right after a task is created, so it only prompts
        when the answer is yes.
        """
        line, task_list, reason = self._today_line_context(template_line_id)
        return {
            'can_add': reason is None,
            'reason': reason or '',
            'date': str(task_list.date) if task_list else '',
            'department_name': line.template_id.department_id.name if line.exists() else '',
        }

    @api.model
    def portal_add_line_to_today(self, template_line_id):
        """Add ONE template line to the ALREADY-SPAWNED list for today.

        Deliberately re-checks every condition rather than trusting the status
        call that preceded it: between the prompt and the tap, the same task
        could have been added from another device, or the day could have
        rolled over. Re-checking makes a double-tap a no-op instead of a
        duplicate task on a list staff are working from.

        The line is built by _line_snapshot_vals — the exact same snapshot the
        nightly spawn uses — so a task added mid-day is indistinguishable from
        one that was there at 02:00.
        """
        line, task_list, reason = self._today_line_context(template_line_id)
        if reason is not None:
            return {'added': False, 'reason': reason}

        vals = self._line_snapshot_vals(line, task_list.date, BERLIN_TZ)
        vals['list_id'] = task_list.id
        # A task added mid-shift must not be born late. _line_snapshot_vals
        # derives an implicit deadline from the PERIOD, with no notion of "now",
        # so adding an Opening task at 15:00 would give it a 12:00 deadline —
        # instantly overdue, and alerting about something nobody had a chance to
        # do. An implicit deadline already in the past is simply dropped: the
        # task still appears on today's list, just without a time.
        if vals.get('deadline_is_implicit') and vals.get('deadline_datetime'):
            if vals['deadline_datetime'] <= fields.Datetime.now():
                vals['deadline_datetime'] = False
                vals['deadline_is_implicit'] = False
        new_line = self.env['krawings.task.list.line'].sudo().create(vals)
        _logger.info(
            '[krawings_task_manager] template line %s added to today\'s list %s (dept %s)',
            line.id, task_list.id, task_list.department_id.id,
        )
        return {'added': True, 'reason': '', 'line_id': new_line.id}

    @api.model
    def portal_reorder_lines(self, template_id, ordered_ids):
        """Persist a manager's drag-and-drop order for ONE day-part section.

        The portal sends that section's line ids in their new order. Lines
        outside the list keep their sequence untouched, which is safe because
        both the editor and the daily spawn order by (day_part, sequence, id) —
        so renumbering within a section can never disturb another one.

        Sequences are rewritten as 10, 20, 30 … rather than patched, so a list
        that arrived with duplicate or equal sequences (older data, or rows
        created before ordering existed) comes out strictly ordered.
        """
        tpl = self.sudo().browse(int(template_id))
        if not tpl.exists():
            raise ValidationError('That template no longer exists.')

        ids = [int(i) for i in (ordered_ids or [])]
        if not ids:
            return {'ok': True, 'reordered': 0}
        if len(set(ids)) != len(ids):
            raise ValidationError('The same task appears twice in the new order.')

        Line = self.env['krawings.task.template.line'].sudo()
        # browse() preserves the caller's order, and iterating the recordset
        # yields that same order — which IS the new order being persisted.
        lines = Line.browse(ids)
        if len(lines.exists()) != len(ids):
            raise ValidationError('One of those tasks no longer exists — reload and try again.')
        # Tenant + integrity guard. Portal calls run as sudo, so record rules do
        # not apply: without this, a crafted request could renumber lines on
        # another department's (or another company's) template.
        if any(line.template_id.id != tpl.id for line in lines):
            raise ValidationError('Those tasks do not all belong to this template.')

        for position, line in enumerate(lines, start=1):
            line.sequence = position * 10
        return {'ok': True, 'reordered': len(ids)}
