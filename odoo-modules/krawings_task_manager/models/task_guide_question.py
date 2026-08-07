from odoo import api, fields, models
from odoo.exceptions import ValidationError

# A guide's questions — the few things a learner has to get right to show they
# took it in.
#
# They hang off the GUIDE, not off a step, and that is load-bearing rather than
# a shrug. Saving a guide is an atomic aggregate rebuild: portal_save_guide
# unlinks every step and recreates it, so every step id is destroyed and
# reissued on each save. A question keyed on a step id would be orphaned the
# first time its guide was edited. `explain_step` is therefore a POSITION —
# 1-based, into the guide's steps in order.
#
# Questions travel with the guide wherever it is used: inside a training course
# and, later, on the task the guide is attached to. That is exactly why they
# belong to the guide and not to a course.

MAX_QUESTIONS_PER_GUIDE = 20
MAX_ANSWERS_PER_QUESTION = 6


class KrawingsTaskGuideQuestion(models.Model):
    _name = 'krawings.task.guide.question'
    _description = 'A question checking that a guide was understood'
    _order = 'sequence, id'

    guide_id = fields.Many2one(
        'krawings.task.guide', required=True, ondelete='cascade', index=True,
    )
    sequence = fields.Integer(required=True, default=0)
    text = fields.Text(required=True)
    # 1-based position of the step that teaches the answer. Sending a learner
    # back to the exact step is what makes "every answer correct" fair rather
    # than harsh: a retry costs a re-read, not a lockout.
    explain_step = fields.Integer(
        default=0,
        help='1-based step number that covers this. 0 = not tied to a step.',
    )
    answer_ids = fields.One2many(
        'krawings.task.guide.answer', 'question_id', copy=True,
    )

    _sql_constraints = [
        ('uniq_guide_seq', 'unique(guide_id, sequence)',
         'Two questions cannot share a position in the same guide.'),
    ]

    @api.constrains('answer_ids')
    def _check_answers(self):
        """Exactly one correct answer, and at least two to choose between.

        A question with no correct answer can never be passed, and one with two
        makes "all answers correct" undefined — both are silent traps for the
        learner rather than for the author, so they are refused at write time.
        """
        for rec in self:
            # An empty set is allowed transiently: the portal writes the
            # question and its answers in one call, and Odoo evaluates the
            # constraint once, after both exist.
            if not rec.answer_ids:
                continue
            if len(rec.answer_ids) < 2:
                raise ValidationError(
                    'A question needs at least two answers to choose between.'
                )
            if len(rec.answer_ids) > MAX_ANSWERS_PER_QUESTION:
                raise ValidationError(
                    'A question can have at most %d answers.' % MAX_ANSWERS_PER_QUESTION
                )
            correct = len(rec.answer_ids.filtered('is_correct'))
            if correct != 1:
                raise ValidationError(
                    'Each question needs exactly one correct answer (this one has %d).' % correct
                )

    @api.constrains('explain_step')
    def _check_explain_step(self):
        for rec in self:
            if rec.explain_step < 0:
                raise ValidationError('The step a question points at cannot be negative.')


class KrawingsTaskGuideAnswer(models.Model):
    _name = 'krawings.task.guide.answer'
    _description = 'One option on a guide question'
    _order = 'sequence, id'

    question_id = fields.Many2one(
        'krawings.task.guide.question', required=True, ondelete='cascade', index=True,
    )
    sequence = fields.Integer(required=True, default=0)
    text = fields.Char(required=True)
    is_correct = fields.Boolean(default=False)
