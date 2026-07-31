/** @odoo-module */

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { SaleDetailsButton } from "@point_of_sale/app/navbar/sale_details_button/sale_details_button";
import { useService } from "@web/core/utils/hooks";
import { Dialog } from "@web/core/dialog/dialog";


export class ClosureConfirmationPopup extends Component {
    static template = "krawings_pos_closing_procedure.ClosureConfirmationPopup";
    static components = { SaleDetailsButton, Dialog };

    setup() {
        super.setup();
        this.hardwareProxy = useService("hardware_proxy");
        this.report = useService("report");
        this.pos = usePos();
        this.ui = useState(useService("ui"));
        this.state = useState({
            closure_confirmation: false,
            closing_staff_name: "",
            terminal_reset: false,
        });
    }

    onChangeConfirmation(ev) {
        this.state.closure_confirmation = ev.currentTarget.checked;
    }

    onChangeName(ev) {
        this.state.closing_staff_name = ev.currentTarget.value;
    }

    // Reminder acknowledgement: the card reader terminal's daily counter must be
    // reset at close. Required, so the register can't be closed until it's done.
    onChangeTerminalReset(ev) {
        this.state.terminal_reset = ev.currentTarget.checked;
    }

    // The acknowledgement checkbox, a typed name, and the card-terminal reset
    // acknowledgement are all required before the staff can confirm closing.
    get canConfirm() {
        return this.state.closure_confirmation
            && this.state.terminal_reset
            && !!this.state.closing_staff_name.trim();
    }

    confirm() {
        this.props.getPayload({
            confirmed: true,
            closing_staff_name: this.state.closing_staff_name.trim(),
        });
        this.props.close();
    }

    cancel() {
        this.props.getPayload({confirmed: false});
        this.props.close();
    }
}
