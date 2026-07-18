/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MoneyDetailsPopup } from "@point_of_sale/app/utils/money_details_popup/money_details_popup";
import { NumberPopup } from "@point_of_sale/app/utils/input_popups/number_popup";
import {
    getButtons,
    DECIMAL,
    ZERO,
    BACKSPACE,
    EMPTY,
} from "@point_of_sale/app/generic_components/numpad/numpad";
import { useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { parseFloat as parseFloatLocale } from "@web/views/fields/parsers";
import { floatIsZero } from "@web/core/utils/numbers";
import { _t } from "@web/core/l10n/translation";

patch(MoneyDetailsPopup.prototype, {
    setup() {
        super.setup();
        this.dialog = useService("dialog");

        // Denomination values (string keys) flagged as coins -> may be counted by value.
        this.coinValues = new Set(
            this.pos.models["pos.bill"]
                .filter((bill) => bill.is_coin)
                .map((bill) => String(bill.value))
        );

        // Coins default to "value" entry (the whole point); notes stay quantity-only.
        const initialMode = {};
        for (const value of this.coinValues) {
            initialMode[value] = "value";
        }
        this.entry = useState({ mode: initialMode }); // { [value]: "qty" | "value" }
    },

    // ---- denomination helpers -------------------------------------------
    isCoin(value) {
        return this.coinValues.has(String(value));
    },
    modeOf(value) {
        return this.entry.mode[value] === "value" ? "value" : "qty";
    },
    _denom(value) {
        return this._parseFloat(value);
    },
    _qtyOf(value) {
        const q = this.state.moneyDetails[value];
        return isNaN(q) || !q ? 0 : q;
    },
    toggleMode(value) {
        if (!this.isCoin(value)) {
            return;
        }
        const nextMode = this.modeOf(value) === "value" ? "qty" : "value";
        this.entry.mode[value] = nextMode;
        // A count of physical coins must be whole: snap when entering quantity mode
        // so the shown number and the running total can never diverge.
        if (nextMode === "qty") {
            this.state.moneyDetails[value] = Math.round(this._qtyOf(value));
        }
    },

    // Number rendered on a row's entry button. Always reflects the stored value:
    // value mode -> the exact euro total; quantity mode -> the (integer) count.
    displayValue(value) {
        const qty = this._qtyOf(value);
        if (!qty) {
            return "";
        }
        if (this.modeOf(value) === "value") {
            return this.env.utils.formatCurrency(this._denom(value) * qty, false);
        }
        return String(qty);
    },

    // ---- interaction ----------------------------------------------------
    step(value, delta) {
        this.state.moneyDetails[value] = Math.max(0, this._qtyOf(value) + delta);
    },

    // Tap a row -> open the POS' own numpad popup (no OS keyboard) to type a value.
    editRow(value) {
        const isValueMode = this.isCoin(value) && this.modeOf(value) === "value";
        const denomLabel = this.env.utils.formatCurrency(this._denom(value));
        this.dialog.add(NumberPopup, {
            title: isValueMode
                ? _t("%s in coins — total value", denomLabel)
                : _t("%s — quantity", denomLabel),
            startingValue: this.displayValue(value) || "0",
            // Value mode allows decimals (a euro amount); quantity mode is a whole
            // count, so drop the decimal key entirely.
            buttons: isValueMode
                ? getButtons([DECIMAL, ZERO, BACKSPACE])
                : getButtons([EMPTY, ZERO, BACKSPACE]),
            formatDisplayedValue: isValueMode
                ? (x) => `${this.pos.currency.symbol} ${x}`
                : (x) => x,
            getPayload: (num) => {
                let parsed = 0;
                try {
                    parsed = num ? parseFloatLocale(num) : 0;
                } catch {
                    parsed = 0;
                }
                if (isNaN(parsed) || parsed < 0) {
                    parsed = 0;
                }
                // Quantity mode stores a whole coin/note count; value mode stores the
                // implied (possibly fractional) count derived from the euro amount.
                this.state.moneyDetails[value] = isValueMode
                    ? parsed / this._denom(value)
                    : Math.round(parsed);
            },
        });
    },

    // ---- confirm (value-mode aware note) --------------------------------
    confirm() {
        const lines = [];
        this.pos.models["pos.bill"].forEach((bill) => {
            const qty = this.state.moneyDetails[bill.value];
            if (!qty) {
                return;
            }
            if (this.isCoin(bill.value) && this.modeOf(bill.value) === "value") {
                lines.push(
                    "\t" +
                        _t(
                            "%s in %s coins",
                            this.env.utils.formatCurrency(this._denom(bill.value) * qty),
                            this.env.utils.formatCurrency(bill.value)
                        )
                );
            } else {
                lines.push("\t" + `${qty} x ${this.env.utils.formatCurrency(bill.value)}`);
            }
        });
        let moneyDetailsNotes = null;
        if (!floatIsZero(this.computeTotal(), this.currency.decimal_places) && lines.length) {
            moneyDetailsNotes =
                this.props.context +
                " details: \n" +
                lines.join("\n") +
                "\n" +
                _t("Total: %s", this.env.utils.formatCurrency(this.computeTotal()));
        }
        this.props.getPayload({
            total: this.computeTotal(),
            moneyDetailsNotes,
            moneyDetails: { ...this.state.moneyDetails },
            action: this.props.action,
        });
        this.props.close();
    },
});
