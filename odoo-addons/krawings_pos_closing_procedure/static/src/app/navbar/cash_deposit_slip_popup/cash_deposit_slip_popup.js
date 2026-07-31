/** @odoo-module */

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";
import { renderToElement } from "@web/core/utils/render";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";

// End-of-day cash-to-safe deposit slip. Replaces the old "print the sales
// report" step: prints, from the POS receipt printer, a breakdown of the cash
// going into the sales bag for the safe. Also records the closing cashier
// (independent of printing) and never blocks the register close.
export class CashDepositSlipPopup extends Component {
    static template = "krawings_pos_closing_procedure.CashDepositSlipPopup";
    static components = { Dialog };
    static props = {
        cashClosing: { type: [Object, Boolean], optional: true },
        closingStaffName: { type: String, optional: true },
        getPayload: { type: Function },
        close: { type: Function },
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.hardwareProxy = useService("hardware_proxy");
        this.dialog = useService("dialog");
        this.state = useState({ printed: false, printing: false });
        // Build the receipt data ONCE so Print and Reprint are identical
        // (same timestamp, same figures).
        this.receiptData = this._buildReceiptData();
        // Record who closed the register, independent of printing. Cached so
        // Done never fires a second RPC.
        this._cashierUpdate = this._recordClosingCashier();
    }

    get hasPrinter() {
        // hardwareProxy.printer is null on the WAJ Sunmi till (no configured
        // device); receipts print via the printer service which waj_sunmi_bridge
        // patches. Recognise that bridge so the slip isn't wrongly disabled.
        return (
            !!this.hardwareProxy.printer ||
            !!(window.SunmiBridge && window.SunmiBridge.printImage)
        );
    }

    _buildReceiptData() {
        const cc = this.props.cashClosing || {};
        const lines = (cc.depositLines || []).map((line) => ({
            label: this.env.utils.formatCurrency(line.value),
            qty: line.depositQty,
            amount: this.env.utils.formatCurrency(line.amount),
        }));
        return {
            restaurant: this.pos.config.name,
            datetime: new Date().toLocaleString(),
            session: this.pos.session.name || `#${this.pos.session.id}`,
            closedBy: this.props.closingStaffName || "",
            lines: lines,
            hasCash: lines.length > 0,
            total: this.env.utils.formatCurrency(cc.depositTotal || 0),
        };
    }

    async _recordClosingCashier() {
        try {
            await this.pos.data.call("pos.session", "update_closing_cashier", [
                [this.pos.session.id],
                this.pos.get_cashier_user_id(),
                this.pos.config.module_pos_hr,
            ]);
        } catch (error) {
            // Never block the close on cashier recording.
            console.warn("[krawings_pos_closing_procedure] Could not record closing cashier", error);
        }
    }

    async print() {
        if (this.state.printing || !this.hasPrinter) {
            return;
        }
        this.state.printing = true;
        try {
            const receipt = renderToElement(
                "krawings_pos_closing_procedure.CashDepositSlipReceipt",
                this.receiptData
            );
            // Print through the printer SERVICE (PosPrinterService.printHtml) —
            // the SAME path receipts use — so waj_sunmi_bridge routes it to the
            // Sunmi built-in printer (WAJ), and the Epson/web-fallback paths work
            // elsewhere. Calling hardwareProxy.printer directly failed on WAJ
            // because no hardware device is configured there (it stays null).
            await this.pos.printer.printHtml(receipt);
            this.state.printed = true;
        } catch (error) {
            // A hardware/transport exception must surface as a recoverable
            // warning, not escape the handler and put the app in an error state.
            console.warn("[krawings_pos_closing_procedure] Deposit slip print failed", error);
            this.dialog.add(AlertDialog, {
                title: _t("Printing failed"),
                body: _t("Could not print the deposit slip. Try again."),
            });
        } finally {
            this.state.printing = false;
        }
    }

    async done() {
        // Make sure the cashier was recorded before we let the close proceed.
        await this._cashierUpdate;
        this.props.getPayload({ done: true });
        this.props.close();
    }
}
