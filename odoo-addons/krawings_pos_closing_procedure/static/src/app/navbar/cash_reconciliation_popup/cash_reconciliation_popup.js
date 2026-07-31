/** @odoo-module */

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { NumericInput } from "@point_of_sale/app/generic_components/inputs/numeric_input/numeric_input";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";

// EUR denominations counted at closing, largest first.
const DENOMINATIONS = ["500", "200", "100", "50", "20", "10", "5", "2", "1", "0.5", "0.2", "0.1", "0.05", "0.02", "0.01"];

// EUR coins are €2 and below (the float that usually stays in the till). Notes
// are €5 and up. "Copy all coins" fills exactly these denomination rows.
const COIN_MAX_VALUE = 2;

function emptyMoneyDetails() {
    return Object.fromEntries(DENOMINATIONS.map((value) => [value, 0]));
}

export class CashReconciliationPopup extends Component {
    static template = "krawings_pos_closing_procedure.CashReconciliationPopup";
    static components = { NumericInput, Dialog };
    static props = {
        default_cash_details: { type: Object },
        action: { type: String },
        getPayload: { type: Function },
        close: { type: Function },
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.ui = useService("ui");
        this.parseFloat = this.props.default_cash_details.utils.parseFloat;
        // What the drawer is expected to hold: opening float + cash sales + cash in/out.
        this.expectedCash = this.props.default_cash_details.amount;
        this.state = useState({
            step: "count",
            drawerMoneyDetails: emptyMoneyDetails(),
            leaveMoneyDetails: emptyMoneyDetails(),
        });
    }

    get denominations() {
        return Object.keys(this.state.drawerMoneyDetails).sort((a, b) => b - a);
    }

    // On the "leave" step we only offer the denominations the cashier actually
    // counted — you can't leave coins or notes that aren't in the drawer.
    get leaveDenominations() {
        return this.denominations.filter((denom) => this.countedFor(denom) > 0);
    }

    // Parse a denomination key ("500", "0.05") to a number for the row label.
    _parseFloat(value) {
        return parseFloat(value);
    }

    isCoin(denom) {
        return this._parseFloat(denom) <= COIN_MAX_VALUE;
    }

    // Quantity of this denomination counted in the drawer at step 1.
    countedFor(denom) {
        return this.state.drawerMoneyDetails[denom] || 0;
    }

    _leaveQty(denom) {
        const raw = this.state.leaveMoneyDetails[denom];
        return Number.isFinite(raw) ? raw : 0;
    }

    // The "leave" quantity matches the counted quantity (row already copied).
    isCopied(denom) {
        const drawerQty = this.countedFor(denom);
        return drawerQty > 0 && this._leaveQty(denom) === drawerQty;
    }

    // Copy one denomination's counted quantity into tomorrow's float.
    copyDenomination(denom) {
        this.state.leaveMoneyDetails[denom] = this.countedFor(denom);
    }

    // Copy every coin (€2 and below) — the usual till float — in one tap.
    // Assign each denomination independently; never alias the two objects.
    copyAllCoins() {
        for (const denom of this.denominations) {
            if (this.isCoin(denom)) {
                this.state.leaveMoneyDetails[denom] = this.countedFor(denom);
            }
        }
    }

    // Per-denomination guard: you cannot leave more of a given coin/note than
    // you counted. This is stricter than the aggregate total check, which could
    // pass while individual rows are impossible (e.g. extra €20 offset by €10).
    denominationValid(denom) {
        const leaveQty = this._leaveQty(denom);
        return leaveQty >= 0 && leaveQty <= this.countedFor(denom);
    }

    get hasOverLeave() {
        return this.leaveDenominations.some((denom) => !this.denominationValid(denom));
    }

    _round(value) {
        const decimals = this.pos.currency?.decimal_places ?? 2;
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    computeTotal(moneyDetails) {
        const total = Object.entries(moneyDetails).reduce((sum, [value, qty]) => {
            const quantity = isNaN(qty) ? 0 : qty;
            return sum + parseFloat(value) * quantity;
        }, 0);
        return this._round(total);
    }

    countedTotal() {
        return this.computeTotal(this.state.drawerMoneyDetails);
    }

    leaveForTomorrow() {
        return this.computeTotal(this.state.leaveMoneyDetails);
    }

    // Cash taken to the safe = everything counted minus tomorrow's float.
    depositToSafe() {
        return this._round(this.countedTotal() - this.leaveForTomorrow());
    }

    // Over/short versus expected (positive = surplus, negative = shortage).
    difference() {
        return this._round(this.countedTotal() - this.expectedCash);
    }

    // You cannot leave more in the drawer than you actually counted, and no
    // single denomination may exceed its counted quantity.
    canConfirm() {
        return this.leaveForTomorrow() >= 0
            && this.leaveForTomorrow() <= this.countedTotal()
            && !this.hasOverLeave;
    }

    nextStep() {
        if (this.state.step === "count") {
            this.state.step = "leave";
        }
    }

    lastStep() {
        if (this.state.step === "leave") {
            this.state.step = "count";
        }
    }

    // Coerce every denomination quantity to a finite, non-negative integer so
    // the snapshot, the money details posted to the core close and the printed
    // deposit breakdown can never carry NaN (e.g. a cleared input) or a
    // manually typed negative count.
    _sanitizeMoneyDetails(details) {
        const clean = {};
        for (const denom of this.denominations) {
            const raw = details[denom];
            clean[denom] = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
        }
        return clean;
    }

    // Per-denomination breakdown of the cash being taken to the safe
    // (counted minus left), consumed by the printed deposit slip.
    _depositLines(drawerMoneyDetails, leaveMoneyDetails) {
        return this.denominations
            .map((denom) => {
                const drawerQty = drawerMoneyDetails[denom] || 0;
                const leaveQty = Number.isFinite(leaveMoneyDetails[denom]) ? leaveMoneyDetails[denom] : 0;
                const depositQty = drawerQty - leaveQty;
                return {
                    denomination: denom,
                    value: this._parseFloat(denom),
                    drawerQty,
                    leaveQty,
                    depositQty,
                    amount: this._round(this._parseFloat(denom) * depositQty),
                };
            })
            .filter((line) => line.depositQty > 0);
    }

    confirm() {
        if (!this.canConfirm()) {
            return;
        }
        // Immutable, sanitised snapshot: the single source of truth for the
        // trimmed Closing Register summary and the cash-to-safe deposit slip.
        // Totals are recomputed from the sanitised maps so the snapshot's
        // figures always agree with its own line items.
        const drawerMoneyDetails = this._sanitizeMoneyDetails(this.state.drawerMoneyDetails);
        const leaveMoneyDetails = this._sanitizeMoneyDetails(this.state.leaveMoneyDetails);
        const counted = this.computeTotal(drawerMoneyDetails);
        const leave = this.computeTotal(leaveMoneyDetails);
        const countedCashOutAmount = this._round(counted - leave);
        // Display difference (counted - expected): positive = surplus/over,
        // negative = shortage/short. Used by the trimmed summary.
        const difference = this._round(counted - this.expectedCash);
        // Report keeps "Closing Cash Discrepancy" as (expected - counted):
        // a positive value is a shortage, a negative value a surplus.
        const cashDifference = this._round(-difference);
        const cashClosing = {
            counted,
            expected: this.expectedCash,
            difference,
            nextOpeningCash: leave,
            countedCashOutAmount,
            cashDifference,
            drawerMoneyDetails,
            leaveMoneyDetails,
            depositLines: this._depositLines(drawerMoneyDetails, leaveMoneyDetails),
            depositTotal: countedCashOutAmount,
        };
        this.props.getPayload({
            counted: counted,
            nextOpeningCash: leave,
            countedCashOutAmount: countedCashOutAmount,
            cashDifference: cashDifference,
            moneyDetails: drawerMoneyDetails,
            // Leave the closing note for the cashier; the denomination breakdown
            // is already captured in the structured moneyDetails above.
            moneyDetailsNotes: "",
            action: this.props.action,
            cashClosing: cashClosing,
        });
        this.props.close();
    }

    cancel() {
        this.props.getPayload(false);
        this.props.close();
    }
}
