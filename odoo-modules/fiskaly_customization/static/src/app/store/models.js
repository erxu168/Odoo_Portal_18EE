/** @odoo-module */

import { PosOrder } from "@point_of_sale/app/models/pos_order";
import { patch } from "@web/core/utils/patch";


patch(PosOrder.prototype, {
    setup(vals) {
        super.setup(...arguments);
        if (this.isCountryGermanyAndFiskaly()) {
            this.is_applicable = vals.is_applicable || false // is applicable, it will not sync with fiskaly
            this.upload_json = []
            this.is_sent_to_fiskaly = vals.is_sent_to_fiskaly || false
            this.bewirtungsbeleg = vals.bewirtungsbeleg || false
        }
    },
});
