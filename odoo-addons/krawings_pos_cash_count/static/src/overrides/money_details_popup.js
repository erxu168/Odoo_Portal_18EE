/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { MoneyDetailsPopup } from "@point_of_sale/app/utils/money_details_popup/money_details_popup";
import { useState } from "@odoo/owl";
import { floatIsZero } from "@web/core/utils/numbers";
import { _t } from "@web/core/l10n/translation";

patch(MoneyDetailsPopup.prototype, {
    setup() {
        super.setup();

        // Denomination values (as string keys) that are flagged as coins and
        // may therefore be counted by value.
        this.coinValues = new Set(
            this.pos.models["pos.bill"]
                .filter((bill) => bill.is_coin)
                .map((bill) => String(bill.value))
        );

        // Coins default to "value" entry (the whole point of this change);
        // notes/bills have no mode entry and stay quantity-only.
        const initialMode = {};
        for (const value of this.coinValues) {
            initialMode[value] = "value";
        }

        this.entry = useState({
            mode: initialMode, // { [value]: "qty" | "value" }
            activeKey: null, // denomination value string currently being edited
            buffer: "", // raw typed string for the active row
            fresh: true, // next keypress replaces the buffer (select-all behaviour)
        });
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

    // ---- display / typing -----------------------------------------------
    // The plain (dot-decimal) string shown for the stored quantity of a row.
    _storedString(value) {
        const qty = this._qtyOf(value);
        if (!qty) {
            return "";
        }
        if (this.modeOf(value) === "value") {
            return (this._denom(value) * qty).toFixed(this.currency.decimal_places);
        }
        return String(qty);
    },
    // What the input should render right now (live buffer for the active row).
    displayValue(value) {
        if (this.entry.activeKey === value) {
            return this.entry.buffer;
        }
        return this._storedString(value);
    },
    // Store a typed string into moneyDetails as a quantity.
    _commit(value, str) {
        const num = parseFloat(str);
        if (isNaN(num)) {
            this.state.moneyDetails[value] = 0;
            return;
        }
        this.state.moneyDetails[value] =
            this.modeOf(value) === "value" ? num / this._denom(value) : num;
    },

    // ---- interaction ----------------------------------------------------
    setActive(value) {
        this.entry.activeKey = value;
        this.entry.buffer = this._storedString(value);
        this.entry.fresh = true;
    },
    toggleMode(value) {
        if (!this.isCoin(value)) {
            return;
        }
        this.entry.mode[value] = this.modeOf(value) === "value" ? "qty" : "value";
        if (this.entry.activeKey === value) {
            this.entry.buffer = this._storedString(value);
            this.entry.fresh = true;
        }
    },
    numpadKey(key) {
        const value = this.entry.activeKey;
        if (value === null) {
            return;
        }
        let buf = this.entry.fresh ? "" : this.entry.buffer;
        this.entry.fresh = false;
        if (key === "backspace") {
            buf = buf.slice(0, -1);
        } else if (key === ".") {
            if (!buf.includes(".")) {
                buf = (buf || "0") + ".";
            }
        } else {
            buf += key;
        }
        this.entry.buffer = buf;
        this._commit(value, buf);
    },
    step(value, delta) {
        const qty = Math.max(0, this._qtyOf(value) + delta);
        this.state.moneyDetails[value] = qty;
        if (this.entry.activeKey === value) {
            this.entry.buffer = this._storedString(value);
            this.entry.fresh = true;
        }
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
