/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { LoginScreen } from "@point_of_sale/app/screens/login_screen/login_screen";

/**
 * Person-first cashier login.
 *
 * Default pos_hr behaviour: Open/Unlock Register sets `pos.login = true`, which
 * renders a combined screen — a PIN text field PLUS a "pick a cashier" button.
 * Staff find the two entry modes confusing.
 *
 * Here we route Open/Unlock Register straight through the existing, tested
 * `selectCashier(pin=false, login=true, list=true)` path:
 *   1. show the cashier list first (pick the person),
 *   2. then, if that person has a PIN, ask for it on the POS numpad,
 *   3. staff without a PIN are logged in on selection (unchanged),
 *   4. cancel returns to the Open/Unlock Register button.
 *
 * `pos.login` is never set true, so the PIN-first box is simply never shown.
 * No new PIN-validation logic is added — we reuse the core mixin.
 */
patch(LoginScreen.prototype, {
    async openRegister() {
        if (this.pos.config.module_pos_hr) {
            await this.selectCashier(false, true, true);
            return;
        }
        return super.openRegister(...arguments);
    },

    async unlockRegister() {
        // Defensive: unlockRegister also sets pos.login = true in core pos_hr.
        if (this.pos.config.module_pos_hr) {
            await this.selectCashier(false, true, true);
            return;
        }
        return super.unlockRegister?.(...arguments);
    },
});
