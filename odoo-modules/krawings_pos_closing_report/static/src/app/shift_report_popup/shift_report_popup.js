/** @odoo-module **/

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { Dialog } from "@web/core/dialog/dialog";

export class ShiftReportPopup extends Component {
    static template = "krawings_pos_closing_report.ShiftReportPopup";
    static components = { Dialog };
    static props = {
        title: { type: String },
        getPayload: { type: Function },
        close: { type: Function },
    };

    setup() {
        this.pos = usePos();
        this.state = useState({
            issues: "",
            cleaning_done: false,
            notes: "",
        });
    }

    confirm() {
        this.props.getPayload({
            issues: this.state.issues,
            cleaning_done: this.state.cleaning_done,
            notes: this.state.notes,
        });
        this.props.close();
    }

    cancel() {
        this.props.close();
    }
}
