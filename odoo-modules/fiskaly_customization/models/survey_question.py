from odoo import models, fields, api, _
import json


class SurveyQuestion(models.Model):
    _inherit = 'survey.question'

    dynamic_field_type = fields.Selection(
        selection_add=[
            ('payment_type', 'Payment Type'),
            ('receipt_type', 'Receipt Type'),
        ],
        ondelete = {
            'payment_type': 'cascade',
            'receipt_type': 'cascade',
        }
    )

    def _set_default_for_dynamic_payment_type(self):
        if not self.is_dynamic and not self.dynamic_field_type == 'payment_type':
            return
        options = [
            (0, 0, {
                'value': 'Cash',
                'answer_score': 0,
                'payment_type': 'cash',
            }),
            (0, 0, {
                'value': 'Bank',
                'answer_score': 0,
                'payment_type': 'bank',
            }),
            (0, 0, {
                'value': 'Customer Account',
                'answer_score': 0,
                'payment_type': 'pay_later',
            }),
        ]
        self.write({
            'question_type': 'simple_choice',
            'title': 'Payment Method',
            'suggested_answer_ids': [
                (5, 0, 0), 
                *options
            ]
        })

    def _set_default_for_dynamic_receipt_type(self):
        if not self.is_dynamic and not self.dynamic_field_type == 'receipt_type':
            return
        options = [
            (0, 0, {
                'value': 'Bewirtungsbeleg',
                'answer_score': 0,
                'receipt_type': 'bewirtungsbeleg',
            }),
            (0, 0, {
                'value': 'Regular',
                'answer_score': 0,
                'receipt_type': 'regular',
            }),
        ]
        self.write({
            'question_type': 'simple_choice',
            'title': 'Receipt Type',
            'suggested_answer_ids': [
                (5, 0, 0), 
                *options
            ]
        })


class SurveyQuestionAnswer(models.Model):
    _inherit = 'survey.question.answer'

    payment_type = fields.Selection([
        ('cash', 'Cash'),
        ('bank', 'Bank'),
        ('pay_later', 'Customer Account'),
    ], default=False)

    receipt_type = fields.Selection([
        ('bewirtungsbeleg', 'Bewirtungsbeleg'),
        ('regular', 'Regular'),
    ], default=False)


    def _get_non_editable_dynamic_fields(self):
        res = super()._get_non_editable_dynamic_fields()
        res.extend([
            'payment_type',
            'receipt_type',
        ])
        return res
