/** @odoo-module */

import { Input } from "@point_of_sale/app/generic_components/inputs/input/input";
import { patch } from "@web/core/utils/patch";


patch(Input.prototype, {
});

Input.props = { ...Input.props, isReadOnly: { type: Boolean, optional: true }}