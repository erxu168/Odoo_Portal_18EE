from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Training courses — the layer ABOVE the guide library.
#
# A course arranges guides that already exist into chapters. It points at them;
# it never copies them. That is the whole reason this sits above the guide
# rather than inside it: a guide's save is an atomic aggregate rebuild that
# unlinks and recreates every step (and every step id), and the daily task list
# holds a frozen copy of a published guide. Nothing here touches either.
#
# The same guide can therefore be chapter 2 of one course, chapter 5 of another,
# AND attached to a daily task — one guide, edited in one place, appearing
# wherever it is useful.
#
# Design: docs/superpowers/specs/2026-08-07-staff-training-courses-design.md

#: A pass mark of 100 means every answer must be right — the job-skill default.
#: Certifications use a percentage (the §43 hygiene course uses 80).
FULL_MARKS = 100


class KrawingsTrainingCourse(models.Model):
    _name = 'krawings.training.course'
    _description = 'A training course: chapters of existing guides'
    _order = 'name, id'

    name = fields.Char(required=True, index=True)
    description = fields.Text()
    company_id = fields.Many2one(
        'res.company', required=True, index=True, ondelete='restrict',
        default=lambda self: self.env.company,
    )
    # Same contract as a guide: staff never see a draft, and a draft enrols
    # nobody. Publishing is always a deliberate act by a person.
    published = fields.Boolean(
        default=False,
        help='Draft courses are invisible to staff and enrol nobody.',
    )
    # Optimistic concurrency, mirroring the guide editor: two managers editing
    # one course must not silently overwrite each other.
    revision = fields.Integer(default=0, copy=False)

    chapter_ids = fields.One2many(
        'krawings.training.chapter', 'course_id', copy=True,
    )
    chapter_count = fields.Integer(compute='_compute_counts', store=True)
    guide_count = fields.Integer(compute='_compute_counts', store=True)

    # ── Certification settings (stage 2; inert until a course uses them) ──
    certificate = fields.Boolean(
        default=False,
        help='Passing produces a dated, printable record.',
    )
    pass_mark = fields.Integer(
        default=FULL_MARKS,
        help='Percent correct needed to pass. 100 = every answer right.',
    )
    validity_months = fields.Integer(
        default=0,
        help='How long a pass stays valid. 0 = never expires. §43 IfSG is 24.',
    )
    reminder_lead_days = fields.Integer(
        default=30,
        help='How long before a pass lapses to tell the managers.',
    )

    @api.depends('chapter_ids', 'chapter_ids.guide_link_ids')
    def _compute_counts(self):
        for rec in self:
            rec.chapter_count = len(rec.chapter_ids)
            rec.guide_count = sum(len(c.guide_link_ids) for c in rec.chapter_ids)

    @api.constrains('pass_mark')
    def _check_pass_mark(self):
        for rec in self:
            if not (1 <= rec.pass_mark <= 100):
                raise ValidationError('The pass mark must be between 1 and 100 percent.')

    @api.constrains('validity_months', 'reminder_lead_days')
    def _check_validity(self):
        for rec in self:
            if rec.validity_months < 0:
                raise ValidationError('How long a pass stays valid cannot be negative.')
            if rec.reminder_lead_days < 0:
                raise ValidationError('The reminder lead time cannot be negative.')

    # ── Portal API ────────────────────────────────────────────────────────
    # Every entry point is @api.model and company-scoped, and fails CLOSED on an
    # empty scope. tests/odoo-portal-methods.unit.spec.ts enforces the decorator
    # after the same omission shipped twice in one day.

    @api.model
    def portal_list_courses(self, allowed_company_ids=None):
        """Every course in these companies, for the manager's library."""
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed:
            return []
        courses = self.sudo().search([('company_id', 'in', allowed)])
        return [{
            'id': c.id,
            'name': c.name,
            'company_id': c.company_id.id,
            'published': c.published,
            'chapter_count': c.chapter_count,
            'guide_count': c.guide_count,
            'certificate': c.certificate,
        } for c in courses]

    @api.model
    def portal_read_course(self, course_id, allowed_company_ids=None):
        """One course with its chapters and the guides they point at."""
        course = self.sudo().browse(int(course_id))
        if not course.exists():
            return False
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or course.company_id.id not in allowed:
            return False
        return {
            'id': course.id,
            'name': course.name,
            'description': course.description or '',
            'company_id': course.company_id.id,
            'published': course.published,
            'revision': course.revision,
            'certificate': course.certificate,
            'pass_mark': course.pass_mark,
            'validity_months': course.validity_months,
            'reminder_lead_days': course.reminder_lead_days,
            'chapters': [{
                'id': ch.id,
                'name': ch.name,
                'guides': [{
                    'link_id': gl.id,
                    'guide_id': gl.guide_id.id,
                    'name': gl.guide_id.name,
                    'published': gl.guide_id.published,
                    'step_count': gl.guide_id.step_count,
                    'question_count': gl.guide_id.question_count,
                } for gl in ch.guide_link_ids.sorted('sequence')],
            } for ch in course.chapter_ids.sorted('sequence')],
        }

    @api.model
    def portal_create_course(self, name, company_id, allowed_company_ids=None):
        """A new, empty DRAFT course."""
        allowed = [int(c) for c in (allowed_company_ids or [])]
        company_id = int(company_id)
        if not allowed or company_id not in allowed:
            return False
        course = self.sudo().create({
            'name': (name or '').strip() or 'Untitled course',
            'company_id': company_id,
        })
        return {'id': course.id, 'revision': course.revision}

    @api.model
    def portal_save_course(self, course_id, revision, payload, allowed_company_ids=None):
        """Replace a course's settings and its whole chapter structure.

        A whole-set replace of the CHAPTERS ONLY. The guides themselves are
        never touched — the chapter rows are pointers, so rebuilding them costs
        nothing and cannot lose content. This is deliberately unlike the guide's
        own save, which rebuilds real content and is the most delicate code in
        this addon.
        """
        course = self.sudo().browse(int(course_id))
        if not course.exists():
            return {'ok': False, 'error': 'not-found'}
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or course.company_id.id not in allowed:
            return {'ok': False, 'error': 'not-found'}
        if int(revision) != course.revision:
            # Someone else saved while this editor was open. Refuse rather than
            # overwrite work that is not on this screen.
            return {'ok': False, 'error': 'stale', 'revision': course.revision}

        payload = payload or {}
        vals = {}
        if 'name' in payload:
            vals['name'] = (payload.get('name') or '').strip() or course.name
        for key in ('description',):
            if key in payload:
                vals[key] = payload.get(key) or False
        for key in ('published', 'certificate'):
            if key in payload:
                vals[key] = bool(payload.get(key))
        for key in ('pass_mark', 'validity_months', 'reminder_lead_days'):
            if key in payload:
                vals[key] = int(payload.get(key) or 0)

        Chapter = self.env['krawings.training.chapter'].sudo()
        Guide = self.env['krawings.task.guide'].sudo()

        if 'chapters' in payload:
            chapter_vals = []
            for i, ch in enumerate(payload.get('chapters') or []):
                links = []
                seen = set()
                for j, g in enumerate(ch.get('guides') or []):
                    gid = int(g.get('guide_id') or 0)
                    if not gid or gid in seen:
                        continue          # the same guide twice in one chapter
                    guide = Guide.browse(gid)
                    # A course must not become a back door across companies —
                    # the same rule guides and tasks already enforce on each other.
                    if not guide.exists() or guide.company_id.id != course.company_id.id:
                        continue
                    seen.add(gid)
                    links.append((0, 0, {'guide_id': gid, 'sequence': (j + 1) * 10}))
                chapter_vals.append({
                    'course_id': course.id,
                    'sequence': (i + 1) * 10,
                    'name': (ch.get('name') or '').strip() or 'Chapter %d' % (i + 1),
                    'guide_link_ids': links,
                })
            course.chapter_ids.unlink()
            for cv in chapter_vals:
                Chapter.create(cv)

        vals['revision'] = course.revision + 1
        course.write(vals)
        return {'ok': True, 'revision': course.revision}

    @api.model
    def portal_delete_course(self, course_id, allowed_company_ids=None):
        """Delete a course. Its chapters go with it; the guides do not."""
        course = self.sudo().browse(int(course_id))
        if not course.exists():
            return False
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or course.company_id.id not in allowed:
            return False
        course.unlink()
        return True


class KrawingsTrainingChapter(models.Model):
    _name = 'krawings.training.chapter'
    _description = 'A chapter of a training course'
    _order = 'sequence, id'

    course_id = fields.Many2one(
        'krawings.training.course', required=True, ondelete='cascade', index=True,
    )
    sequence = fields.Integer(required=True, default=0)
    name = fields.Char(required=True)
    guide_link_ids = fields.One2many(
        'krawings.training.chapter.guide', 'chapter_id', copy=True,
    )


class KrawingsTrainingChapterGuide(models.Model):
    """One guide's place in one chapter.

    The ORDER lives here rather than on the guide, so the same guide can be
    second in one course and fifth in another without the two fighting.
    """
    _name = 'krawings.training.chapter.guide'
    _description = 'A guide placed in a chapter'
    _order = 'sequence, id'

    chapter_id = fields.Many2one(
        'krawings.training.chapter', required=True, ondelete='cascade', index=True,
    )
    # restrict, not cascade: deleting a guide that a course teaches should be
    # refused and explained, exactly as it already is for a guide used by tasks.
    guide_id = fields.Many2one(
        'krawings.task.guide', required=True, ondelete='restrict', index=True,
    )
    sequence = fields.Integer(required=True, default=0)

    _sql_constraints = [
        ('uniq_chapter_guide', 'unique(chapter_id, guide_id)',
         'That guide is already in this chapter.'),
    ]
