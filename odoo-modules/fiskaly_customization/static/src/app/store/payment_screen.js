/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { SurveySurvey } from "../../../../../pos_survey/static/src/app/models/survey_survey";


patch(PaymentScreen.prototype, {
    // we check to see which payment method is selected so we can apply points
    // to the survey answers
    async validateOrder(isForceValidate) {
        var survey_ids = this.pos.models["survey.survey"].filter((survey) =>
            survey.pos_survey_timing == "order"
        );
        const survey_question_ids = this.pos.models["survey.question"].getAll()
        
        if (survey_ids.length==0 || !this.pos.config.evaluate_scores) {
            return super.validateOrder(isForceValidate)
        }
    
        for (const question of survey_question_ids) {
            if (question.dynamic_field_type !== "payment_type") {
                continue
            }
            const option_ids = this.pos.models["survey.question.answer"].filter((option) =>
                option.question_id.id == question.id
            )
            for (const option of option_ids) {
                const line = this.paymentLines.find((line) => line.payment_method_id.type.toLowerCase() === option.value.toLowerCase())
                if (line !== undefined) {
                    this.currentOrder.survey_answers.push({
                        survey_id: question.survey_id.id,
                        question_id: question.id,
                        value: option.value,
                        option_id: option.id,
                        points: option.answer_score,
                    })
                }
            }
        }
        return super.validateOrder(isForceValidate)
    },
})
