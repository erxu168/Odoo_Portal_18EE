/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { MoneyDetailsPopup } from "@point_of_sale/app/utils/money_details_popup/money_details_popup";

patch(MoneyDetailsPopup.prototype, {
    // Close the coins/notes popup without confirming. Callers only act on the
    // confirm payload, so simply closing is treated as a cancel.
    cancel() {
        this.props.close();
    },
});
