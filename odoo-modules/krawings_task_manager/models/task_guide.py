from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .task_template_line import (
    GUIDE_MAX_STEPS,
    GUIDE_MAX_PINS,
    GUIDE_MAX_EXPLANATION,
    MAX_RICH_TEXT_BYTES,
    rich_text_to_plain,
    sanitize_rich_text,
    GUIDE_MAX_NOTE,
    GUIDE_MAX_IMAGE_B64,
    GUIDE_MAX_PDF_B64,
)
from .task_guide_step import normalize_drawings

GUIDE_MAX_NAME = 120


class KrawingsTaskGuide(models.Model):
    """A REUSABLE guided tutorial, owned by a company. This is the library:
    a guide is a standalone, named thing and any number of tasks LINK to it
    (krawings.task.template.line.guide_id). Edit the guide once → every task
    that links it, and the staff Training area, see the change.

    The guide is just an ordered collection of krawings.task.guide.step rows
    (photo / youtube / tip / pdf + explanation; photo steps may carry note-pins).
    PURELY INSTRUCTIONAL — opening a guide never completes any task. When a daily
    task is spawned it takes an immutable SNAPSHOT of the guide it links, so past
    days keep exactly what staff saw then even after the guide is later edited."""
    _name = 'krawings.task.guide'
    _description = 'Reusable Guided Tutorial'
    _order = 'name, id'

    name = fields.Char(required=True, index=True)
    company_id = fields.Many2one(
        'res.company', required=True, index=True, ondelete='restrict',
        default=lambda self: self.env.company,
    )
    published = fields.Boolean(
        default=False,
        help='When on, staff can open this guide (from a linked task or the '
             'Training area). Off = draft, managers only.',
    )
    revision = fields.Integer(
        default=0, copy=False,
        help='Bumped on every content save; optimistic-concurrency token for the '
             'editor and the value each daily snapshot records.',
    )
    step_ids = fields.One2many('krawings.task.guide.step', 'guide_id', copy=True)
    question_ids = fields.One2many(
        'krawings.task.guide.question', 'guide_id', copy=True,
    )
    question_count = fields.Integer(compute='_compute_question_count', store=True)
    step_count = fields.Integer(compute='_compute_counts', store=True)
    has_steps = fields.Boolean(compute='_compute_counts', store=True)

    template_line_ids = fields.One2many(
        'krawings.task.template.line', 'guide_id',
        help='Tasks that link this guide.',
    )
    template_line_count = fields.Integer(
        compute='_compute_template_line_count', store=True,
        help='How many tasks currently link this guide ("Used by N tasks").',
    )

    @api.depends('step_ids')
    def _compute_counts(self):
        for rec in self:
            rec.step_count = len(rec.step_ids)
            rec.has_steps = bool(rec.step_ids)

    @api.depends('question_ids')
    def _compute_question_count(self):
        for rec in self:
            rec.question_count = len(rec.question_ids)

    @api.depends('template_line_ids')
    def _compute_template_line_count(self):
        for rec in self:
            rec.template_line_count = len(rec.template_line_ids)

    @api.constrains('company_id')
    def _check_company_matches_links(self):
        """A guide can't be moved to another company while a task in a different
        company still links it (the mirror of template.line._check_guide_company,
        which only fires on the task side)."""
        for guide in self:
            for line in guide.template_line_ids:
                if line.template_id.company_id != guide.company_id:
                    raise ValidationError(
                        'This guide is linked to a task in another company. '
                        'Detach those tasks before changing its company.'
                    )

    @api.constrains('published', 'step_ids')
    def _check_published_guide_complete(self):
        """Invariant: a PUBLISHED guide is always complete (>=1 step, every step
        has an explanation + its own media). Backstop that makes "published ⟹
        complete" true even against a direct write, and guarantees the nightly
        snapshot only ever copies complete guides. portal_save_guide raises
        friendlier per-step messages before this fires."""
        for guide in self:
            if not guide.published:
                continue
            steps = guide.step_ids.sorted('sequence')
            if not steps:
                raise ValidationError('A published guide needs at least one step.')
            for i, s in enumerate(steps, 1):
                if not rich_text_to_plain(s.explanation):
                    raise ValidationError('Step %s needs an explanation before the guide can be published.' % i)
                if s.media_type == 'photo' and not s.image:
                    raise ValidationError('Step %s needs a photo before the guide can be published.' % i)
                if s.media_type == 'pdf' and not s.pdf_file:
                    raise ValidationError('Step %s needs a PDF before the guide can be published.' % i)
                if s.media_type == 'youtube' and not (s.youtube_url and s.youtube_url.strip()):
                    raise ValidationError('Step %s needs a YouTube link before the guide can be published.' % i)

    # ── Library RPC (manager/admin; company checked in the portal route) ──────
    @api.model
    def portal_list_guides(self, allowed_company_ids=None):
        """Return every guide in the caller's companies for the Library screen.
        Fail CLOSED: no company scope → nothing."""
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed:
            return []
        guides = self.sudo().search([('company_id', 'in', allowed)])
        return [{
            'id': g.id,
            'name': g.name,
            'company_id': g.company_id.id,
            'published': g.published,
            'revision': g.revision,
            'step_count': g.step_count,
            'template_line_count': g.template_line_count,
        } for g in guides]

    @api.model
    def portal_create_guide(self, name, company_id):
        """Create an empty draft guide and return its id. The editor then saves
        steps into it via portal_save_guide."""
        name = (name or '').strip()
        if not name:
            raise UserError('A guide needs a name.')
        if len(name) > GUIDE_MAX_NAME:
            raise UserError('The guide name is too long (max %s characters).' % GUIDE_MAX_NAME)
        if not company_id:
            raise UserError('A guide needs a company.')
        guide = self.sudo().create({
            'name': name,
            'company_id': int(company_id),
            'published': False,
            'revision': 0,
        })
        return {'id': guide.id, 'revision': guide.revision}

    @api.model
    def portal_read_guide(self, guide_id):
        """Return a guide's full content for the editor. Media bytes are NOT
        inlined — the editor fetches them via the step-media route."""
        guide = self.sudo().browse(int(guide_id))
        if not guide.exists():
            return False
        steps = []
        for s in guide.step_ids.sorted('sequence'):
            steps.append({
                'id': s.id,
                'media_type': s.media_type,
                'explanation': s.explanation or '',
                'has_image': bool(s.image),
                'image_filename': s.image_filename or '',
                'has_pdf': bool(s.pdf_file),
                'pdf_filename': s.pdf_filename or '',
                'youtube_url': s.youtube_url or '',
                'drawings': s.drawings or '',
                'pins': [
                    {'id': p.id, 'pin_x': p.pin_x, 'pin_y': p.pin_y, 'note': p.note or ''}
                    for p in s.pin_ids.sorted('sequence')
                ],
            })
        return {
            'id': guide.id,
            'name': guide.name,
            'questions': [
                {
                    'id': q.id,
                    'text': q.text or '',
                    'explain_step': q.explain_step or 0,
                    'answers': [
                        {'text': a.text or '', 'is_correct': a.is_correct}
                        for a in q.answer_ids.sorted('sequence')
                    ],
                }
                for q in guide.question_ids.sorted('sequence')
            ],
            'company_id': guide.company_id.id,
            'revision': guide.revision,
            'published': guide.published,
            'template_line_count': guide.template_line_count,
            'steps': steps,
        }

    @api.model
    def portal_save_questions(self, guide_id, questions, allowed_company_ids=None):
        """Replace a guide's questions with exactly `questions`.

        Deliberately SEPARATE from portal_save_guide. That method is an atomic
        aggregate rebuild of the steps — it unlinks and recreates every one, and
        it is the most delicate code in this addon. Questions do not belong in
        it: they change on a different rhythm (an author tweaks wording without
        touching a photo), and a bug here must not be able to cost anyone their
        step media.

        Whole-set replace rather than per-row patching: the editor always sends
        the complete list, so a deleted question genuinely disappears instead of
        lingering and being asked forever.

        Company-scoped, fails CLOSED — an empty scope is refused, like every
        other portal entry point here.
        """
        guide = self.sudo().browse(int(guide_id))
        if not guide.exists():
            return False
        allowed = [int(c) for c in (allowed_company_ids or [])]
        if not allowed or guide.company_id.id not in allowed:
            return False

        Question = self.env['krawings.task.guide.question'].sudo()
        step_count = len(guide.step_ids)

        vals = []
        for i, q in enumerate(questions or []):
            text = (q.get('text') or '').strip()
            if not text:
                continue
            answers = [a for a in (q.get('answers') or []) if (a.get('text') or '').strip()]
            # Refuse quietly rather than raise: the caller has already validated,
            # and a half-formed question is dropped instead of blocking the save
            # of the good ones.
            if len(answers) < 2 or sum(1 for a in answers if a.get('is_correct')) != 1:
                continue
            # A pointer past the end of the guide would send a learner nowhere.
            explain = int(q.get('explain_step') or 0)
            if explain < 0 or explain > step_count:
                explain = 0
            vals.append({
                'guide_id': guide.id,
                'sequence': (i + 1) * 10,
                'text': text,
                'explain_step': explain,
                'answer_ids': [
                    (0, 0, {
                        'sequence': (j + 1) * 10,
                        'text': (a.get('text') or '').strip()[:300],
                        'is_correct': bool(a.get('is_correct')),
                    })
                    for j, a in enumerate(answers)
                ],
            })

        guide.question_ids.unlink()
        for v in vals:
            Question.create(v)
        return len(vals)

    @api.model
    def portal_save_guide(self, guide_id, revision, published, steps, name=None):
        """Atomically replace a guide's whole ordered content.

        Row-locks the guide and compares `revision` (optimistic concurrency): a
        stale editor gets {conflict:True} (mapped to 409) instead of clobbering
        another manager. Array order is authoritative → normalized sequences. A
        step may `keep` its existing photo/pdf (no base64 re-sent); the prior
        bytes are carried over server-side. Editing content bumps the revision
        once (so the next spawn snapshots the new version); attach/detach a task
        does NOT go through here. Returns {ok, revision}."""
        guide = self.sudo().browse(int(guide_id))
        if not guide.exists():
            raise UserError('Guide not found.')
        steps = steps or []
        if len(steps) > GUIDE_MAX_STEPS:
            raise UserError('A guide can have at most %s steps.' % GUIDE_MAX_STEPS)

        self.env.flush_all()
        self.env.cr.execute(
            'SELECT revision FROM krawings_task_guide WHERE id = %s FOR UPDATE',
            (guide.id,),
        )
        row = self.env.cr.fetchone()
        current = (row[0] if row else 0) or 0
        if int(revision) != int(current):
            return {'conflict': True, 'revision': current}

        if name is not None:
            new_name = (name or '').strip()
            if not new_name:
                raise UserError('A guide needs a name.')
            if len(new_name) > GUIDE_MAX_NAME:
                raise UserError('The guide name is too long (max %s characters).' % GUIDE_MAX_NAME)
            if new_name != guide.name:
                guide.name = new_name

        # Snapshot existing media so a `keep` step needn't re-upload its bytes.
        prior = {
            s.id: {
                'image': s.image, 'image_filename': s.image_filename,
                'pdf_file': s.pdf_file, 'pdf_filename': s.pdf_filename,
                'drawings': s.drawings,
            }
            for s in guide.step_ids
        }

        # Completeness is a PUBLISH-time rule: a published guide must have every
        # step finished (explanation + its own media). A DRAFT may be saved with
        # half-finished steps so managers can checkpoint work-in-progress.
        if published:
            for idx, st in enumerate(steps, 1):
                mt = st.get('media_type')
                prev = prior.get(int(st.get('id') or 0), {})
                # rich_text_to_plain, not strip(): an empty editor serialises as
                # <p></p>, which is truthy and would sail past a bare strip().
                if not rich_text_to_plain(st.get('explanation') or ''):
                    raise UserError('Step %s needs an explanation before you can publish.' % idx)
                if mt == 'photo' and not (st.get('image_base64') or prev.get('image')):
                    raise UserError('Step %s needs a photo before you can publish.' % idx)
                if mt == 'pdf' and not (st.get('pdf_base64') or prev.get('pdf_file')):
                    raise UserError('Step %s needs a PDF before you can publish.' % idx)
                if mt == 'youtube' and not (st.get('youtube_url') or '').strip():
                    raise UserError('Step %s needs a YouTube link before you can publish.' % idx)

        guide.step_ids.unlink()  # cascade pins; clean sequences on rebuild

        Step = self.env['krawings.task.guide.step'].sudo()
        Pin = self.env['krawings.task.guide.pin'].sudo()
        seq = 10
        for st in steps:
            mt = st.get('media_type')
            # Formatted text: sanitise BEFORE storing — staff render this, so the
            # stored value must already be safe rather than relying on the
            # portal to clean it at display time.
            raw_explanation = st.get('explanation') or ''
            if len(raw_explanation) > MAX_RICH_TEXT_BYTES:
                raise UserError('An explanation is too large. Remove some formatting or a very long link.')
            explanation = sanitize_rich_text(raw_explanation)
            # Measure the WORDS, not the markup: otherwise bullets and bold
            # would quietly shrink how much a manager can actually write.
            if len(rich_text_to_plain(explanation)) > GUIDE_MAX_EXPLANATION:
                raise UserError('An explanation is too long (max %s characters).' % GUIDE_MAX_EXPLANATION)
            prev = prior.get(int(st.get('id') or 0), {})
            vals = {
                'guide_id': guide.id,
                'sequence': seq,
                'media_type': mt,
                'explanation': explanation,
                'image': False, 'image_filename': False,
                'pdf_file': False, 'pdf_filename': False,
                'youtube_url': False,
                'drawings': False,
            }
            if mt == 'photo':
                # Author's drawn marks over the photo (validated + clamped here,
                # so nothing unsafe can reach the SVG the portal renders).
                # An ABSENT key means "keep what's stored" — the legacy per-task
                # client predates drawings and must not wipe them; a client that
                # sends '' is deliberately clearing.
                vals['drawings'] = (
                    normalize_drawings(st['drawings']) if 'drawings' in st
                    else prev.get('drawings')
                )
                if st.get('image_base64'):
                    b64 = st['image_base64']
                    if len(b64) > GUIDE_MAX_IMAGE_B64:
                        raise UserError('A photo is too large (max ~9 MB).')
                    vals['image'] = b64
                    vals['image_filename'] = st.get('image_filename') or 'photo.jpg'
                else:
                    vals['image'] = prev.get('image')
                    vals['image_filename'] = prev.get('image_filename')
            elif mt == 'pdf':
                if st.get('pdf_base64'):
                    b64 = st['pdf_base64']
                    if len(b64) > GUIDE_MAX_PDF_B64:
                        raise UserError('A PDF is too large (max ~15 MB).')
                    vals['pdf_file'] = b64
                    vals['pdf_filename'] = st.get('pdf_filename') or 'document.pdf'
                else:
                    vals['pdf_file'] = prev.get('pdf_file')
                    vals['pdf_filename'] = prev.get('pdf_filename')
            elif mt == 'youtube':
                vals['youtube_url'] = (st.get('youtube_url') or '').strip()
            # 'tip' keeps everything empty.
            step = Step.create(vals)   # model constraints validate media + explanation

            if mt == 'photo':
                pins = st.get('pins') or []
                if len(pins) > GUIDE_MAX_PINS:
                    raise UserError('A photo can have at most %s note-pins.' % GUIDE_MAX_PINS)
                pseq = 10
                for p in pins:
                    note = (p.get('note') or '').strip()
                    if len(note) > GUIDE_MAX_NOTE:
                        raise UserError('A pin note is too long (max %s characters).' % GUIDE_MAX_NOTE)
                    Pin.create({
                        'step_id': step.id,
                        'sequence': pseq,
                        'pin_x': float(p.get('pin_x') or 0.0),
                        'pin_y': float(p.get('pin_y') or 0.0),
                        'note': note,
                    })
                    pseq += 10
            seq += 10

        new_rev = current + 1
        guide.write({'revision': new_rev, 'published': bool(published)})
        return {'ok': True, 'revision': new_rev}

    @api.model
    def portal_delete_guide(self, guide_id=None):
        """Delete a guide — only when no task links it.

        @api.model with a still-optional guide_id: the portal passes the id, and
        the `else self` branch keeps any instance-style caller working. Without
        the decorator this happened to work by accident — call_kw swallowed the
        id as a recordset and the `else` branch picked it up — which is exactly
        the ambiguity that cost two outages in one day. A used guide is kept
        (ondelete='restrict' also protects it at the DB level); the caller is
        told to detach it first. Unused → cascade steps/pins; any daily snapshots
        already taken remain (their source ref just goes null)."""
        guide = self.sudo().browse(int(guide_id)) if guide_id else self
        if not guide.exists():
            raise UserError('Guide not found.')
        if guide.template_line_count:
            raise UserError(
                'This guide is used by %s task(s). Detach it from those tasks first.'
                % guide.template_line_count
            )
        guide.unlink()
        return {'ok': True}
