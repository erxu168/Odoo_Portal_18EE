/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ClosePosPopup } from "@point_of_sale/app/navbar/closing_popup/closing_popup";
import { ShiftReportPopup } from "../../app/shift_report_popup/shift_report_popup";
import { _t } from "@web/core/l10n/translation";

patch(ClosePosPopup.prototype, {
    async closeSession() {
        // Intercept closeSession to show the Shift Report Popup
        let shiftAnswers = null;

        await new Promise((resolve) => {
            this.dialog.add(ShiftReportPopup, {
                title: _t("Shift Report"),
                getPayload: (payload) => {
                    shiftAnswers = payload;
                    resolve();
                },
                close: () => {
                    resolve();
                },
            });
        });

        // If shiftAnswers is null, they clicked cancel, so we do NOT close the session.
        if (!shiftAnswers) {
            return;
        }

        // Save the answers to the backend
        try {
            await this.pos.data.call("pos.session", "save_shift_report", [
                this.pos.session.id,
                shiftAnswers,
            ]);
        } catch (error) {
            console.error("Failed to save shift report", error);
        }

        // Proceed with original closeSession
        return await super.closeSession(...arguments);
    }
});
