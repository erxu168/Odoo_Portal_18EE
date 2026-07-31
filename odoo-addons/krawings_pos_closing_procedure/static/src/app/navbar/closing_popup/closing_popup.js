/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { ClosePosPopup } from "@point_of_sale/app/navbar/closing_popup/closing_popup";
import { _t } from "@web/core/l10n/translation";
import { ClosureConfirmationPopup } from "@krawings_pos_closing_procedure/app/navbar/closure_confirmation_popup/closure_confirmation_popup";
import { CashReconciliationPopup } from "@krawings_pos_closing_procedure/app/navbar/cash_reconciliation_popup/cash_reconciliation_popup";
import { CashDepositSlipPopup } from "@krawings_pos_closing_procedure/app/navbar/cash_deposit_slip_popup/cash_deposit_slip_popup";
import { useService } from "@web/core/utils/hooks";
import { makeAwaitable } from "@point_of_sale/app/store/make_awaitable_dialog";


patch(ClosePosPopup.prototype, {
    // Krawings: allow ALL staff (not just POS managers) to finish the
    // end-of-day close when the counted cash differs from expected. They still
    // get the core "money doesn't match - Proceed Anyway?" confirmation, the
    // cash-count step is kept, and the manager is still emailed the discrepancy
    // on close (pos_session._validate_session -> send_daily_sale_summary).
    // This only removes the manager-only hard stop.
    hasUserAuthority() {
        return true;
    },
    setup() {
        this.report = useService("report");
        super.setup(...arguments);
        // Reactive copy of the reconciliation snapshot so the trimmed summary
        // re-renders after "Recount cash" (props themselves are not reactive).
        this.state.krwCashClosing = this.props.orders_details.custom_display.cash_closing;
    },
    getInitialState() {
        const initialState = super.getInitialState();
        if (this.pos.config.cash_control) {
            let counted = "0";
            if (this.props.default_cash_details.counted) {
                counted = this.env.utils.formatCurrency(this.props.default_cash_details.counted, false);
                // counted = this.props.default_cash_details.counted.toString();
            };
            initialState.payments[this.props.default_cash_details.id] = {
                counted: counted,
            };
        }
        if (this.props.orders_details.moneyDetails) {
            initialState.moneyDetails = this.props.orders_details.moneyDetails;
        }
        if (this.props.orders_details.moneyDetailsNotes) {
            initialState.notes = this.props.orders_details.moneyDetailsNotes;
        }
        return initialState;
    },

    // Reopen the cash-count / leave-float flow from the trimmed summary and
    // refresh the displayed figures + the values the core close will post.
    async recountCash() {
        const action = _t("Cash Reconciliation");
        this.pos.hardwareProxy.openCashbox(action);
        const payload = await makeAwaitable(this.dialog, CashReconciliationPopup, {
            default_cash_details: this.props.default_cash_details,
            action: action,
        });
        if (!payload) {
            return;
        }
        // Recompute derived cash figures + snapshot deterministically from base.
        this.pos.applyCashReconciliation(this.props, payload);
        // The field the core close posts as the counted (closing) cash: the
        // float LEFT in the drawer, not the full count (see applyCashReconciliation).
        this.state.payments[this.props.default_cash_details.id].counted =
            this.env.utils.formatCurrency(payload.nextOpeningCash, false);
        // Reactive copy drives the summary re-render.
        this.state.krwCashClosing = payload.cashClosing;
    },

    async closeSession() {
        const result = await makeAwaitable(this.dialog, ClosureConfirmationPopup, {});
        // makeAwaitable resolves undefined when the dialog is dismissed (X /
        // escape), so guard before reading the payload; only an explicit
        // confirmation proceeds.
        if (!result || !result.confirmed) {
            return;
        }
        const closing_staff_name = result.closing_staff_name;
        // Persist the name the staff signed with on the disclaimer window so
        // the daily sales email shows who closed the session. Wrapped in
        // try/catch: a save failure must never block the register from closing.
        try {
            await this.pos.data.call("pos.session", "set_closing_staff_name", [
                [this.pos.session.id],
                closing_staff_name,
            ]);
        } catch (error) {
            console.warn("[krawings_pos_closing_procedure] Could not save closing staff name", error);
        }
        // Print the cash-to-safe deposit slip (replaces the old sales-report
        // print). The popup records the closing cashier itself and never blocks
        // the close if the printer is missing or fails. Only shown when there
        // was a cash reconciliation to deposit (cash-control registers).
        const cashClosing = this.props.orders_details.custom_display.cash_closing;
        if (this.pos.config.cash_control && cashClosing) {
            await makeAwaitable(this.dialog, CashDepositSlipPopup, {
                cashClosing: cashClosing,
                closingStaffName: closing_staff_name,
            });
        }
        await this.processCashOut();
        return super.closeSession();
    },

    async processCashOut() {
        const amount = this.props.orders_details.custom_display.cash_details.details[0].amount;
        const formattedAmount = this.env.utils.formatCurrency(amount);
        if (!amount) {
            return;
        } else {
            const type = 'out';
            const translatedType = _t(type);
            const extras = { formattedAmount, translatedType };
            const reason = 'End of Day Cash Out';
            await this.pos.data.call(
                "pos.session",
                "try_cash_in_out",
                [
                    [this.pos.session.id],
                    type,
                    amount,
                    reason,
                    extras,
                ]
            );
            await this.pos.logEmployeeMessage(
                `${_t("Cash")} ${translatedType} - ${_t("Amount")}: ${formattedAmount}`,
                "CASH_DRAWER_ACTION"
            );
        }
    }
});
