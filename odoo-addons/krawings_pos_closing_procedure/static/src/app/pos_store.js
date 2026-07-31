/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import {PosSurveyPopup} from "@pos_survey/app/pos_survey_popup/pos_survey_popup";
import { ClosePosPopup } from "@point_of_sale/app/navbar/closing_popup/closing_popup";
import { CashReconciliationPopup } from "@krawings_pos_closing_procedure/app/navbar/cash_reconciliation_popup/cash_reconciliation_popup";
import { _t } from "@web/core/l10n/translation";
import { parseFloat } from "@web/views/fields/parsers";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { makeAwaitable } from "@point_of_sale/app/store/make_awaitable_dialog";

patch(PosStore.prototype, {
    async handleClosingError(response) {
        return new Promise((resolve) => {
            this.dialog.add(ConfirmationDialog, {
                title: response.title || "Error",
                body: response.message,
                confirmLabel: _t("Review Orders"),
                cancelLabel: _t("Cancel Orders"),
                confirm: () => {
                    if (!response.redirect) {
                        this.showScreen("TicketScreen");
                        resolve()
                    }
                },
                cancel: async () => {
                    if (!response.redirect) {
                        const ordersDraft = this.models["pos.order"].filter((o) => !o.finalized);
                        await this.deleteOrders(ordersDraft, response.open_order_ids);
                        resolve()
                    }
                },
                dismiss: async () => {resolve()},
            });
        });
    },

    // Fold a Cash Reconciliation payload into the ClosePosPopup `info` object.
    // Shared by the initial close and the summary's "Recount cash" action so the
    // derived cash figures are always recomputed from a captured base (never
    // added twice). Stores the immutable snapshot the trimmed summary + deposit
    // slip read from.
    applyCashReconciliation(info, payload) {
        const { countedCashOutAmount, cashDifference, nextOpeningCash, counted, cashClosing } = payload;
        const cd = info.orders_details.custom_display.cash_details;
        // Capture the pre-reconciliation base once (existing cash-outs /
        // discrepancy during the day) so recount can recompute deterministically.
        if (!info.orders_details.custom_display.cash_closing_base) {
            info.orders_details.custom_display.cash_closing_base = {
                cashOut: cd.details[0].amount,
                discrepancy: cd.details[1].amount,
            };
        }
        const base = info.orders_details.custom_display.cash_closing_base;
        cd.details[0].amount = base.cashOut + countedCashOutAmount; // End of Day Cash Out (to safe)
        cd.details[1].amount = base.discrepancy + cashDifference;   // Closing Cash Discrepancy
        cd.amount = nextOpeningCash;                                // Next day opening float
        // The closing balance Odoo records must be the cash LEFT in the drawer
        // (nextOpeningCash), NOT the full drawer count. processCashOut() removes
        // the deposit as a −deposit cash-out, which already lowers Odoo's
        // theoretical closing cash; recording the full count on top of that
        // double-counts the deposit -> a phantom "profit" equal to the deposit
        // AND the next session opening (last_session_closing_cash =
        // cash_register_balance_end_real) inherits the full drawer instead of
        // the float. Posting the float left makes Odoo's closing difference
        // = leave - (expected - deposit) = full_count - expected = the TRUE
        // over/short, and the next opening float = leave. (Matches the
        // pre-refactor / production behaviour; the full drawer count is still
        // kept in cashClosing.counted for the summary and deposit slip.)
        info.default_cash_details.counted = nextOpeningCash;
        info.orders_details.moneyDetails = payload.moneyDetails;
        info.orders_details.moneyDetailsNotes = payload.moneyDetailsNotes;
        info.orders_details.custom_display.cash_closing = cashClosing;
    },

   async closeSession() {
        const response = await this.data.call(
            "pos.session",
            "can_close_session",
            [this.session.id],
        );
        if (!response.successful) {
            await this.handleClosingError(response);
            return
        }

        // no other option but to repeat this action from the pos_survey module
        // We could explore refractoring later to prervent method override
        var surveys = this.models["survey.survey"].filter((survey) =>
            survey.pos_survey_timing == "session"
        );
        if (surveys.length>0) {
            const payload = await makeAwaitable(this.dialog, PosSurveyPopup, {
                pos: this,
                surveys: surveys,
                pos_survey_questions: this.models["survey.question"].getAll(),
                pos_survey_options: this.models["survey.question.answer"].getAll(),
                pos_survey_answers: this.survey_answers,
                onSubmitSurvey: this.onSubmitSurvey.bind(this),
            });
            if (payload) {
                this.data.call("pos.session", "process_survey", [
                    this.session.id,
                    this.survey_answers,
                ]);
            }
        }

        const info = await this.getClosePosInfo();

        if (!this.config.cash_control) {
            // Reset the local cache only when the user commits to closing (not
            // before the reconciliation popup), so cancelling leaves the
            // session and its local data intact.
            await this.data.resetIndexedDB();
            await makeAwaitable(this.dialog, ClosePosPopup, info);
            return
        }
        // cant import parseFloat correctly in cashReconciliationPopup
        info.default_cash_details.utils = { parseFloat: parseFloat }

        const action = _t("Cash Reconciliation");
        this.hardwareProxy.openCashbox(action);
        const payload = await makeAwaitable(this.dialog, CashReconciliationPopup, {
            default_cash_details: info.default_cash_details,
            action: action,
        });

        if (payload) {
            // Cashier completed reconciliation: now safe to clear local cache.
            await this.data.resetIndexedDB();
            this.applyCashReconciliation(info, payload);
            this.dialog.add(ClosePosPopup, info);
        }
    }
});
