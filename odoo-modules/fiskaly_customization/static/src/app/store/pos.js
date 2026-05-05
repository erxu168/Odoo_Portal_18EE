/** @odoo-module */

import { uuidv4 } from "@point_of_sale/utils";
import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { OrderReceipt2 } from "@krawings_pos_receipt/js/order_receipt";


patch(PosStore.prototype, {
    async setup() {
        await super.setup(...arguments)
        const data = this.retrieveKeys()
        this.l10n_de_fiskaly_signature_public_key = data.l10n_de_fiskaly_signature_public_key || this.generateSignaturePublic(88)
        this.l10n_de_fiskaly_client_serial_number = data.l10n_de_fiskaly_client_serial_number || uuidv4()
    },

    // Two things:
    // 1. bewirtungsbeleg receipt must be sent to fiskaly.
    // 2. Add survey answer for receipt_type if applicable
    async printReceipt({
            basic = false,
            order = this.get_order(),
            printBillActionTriggered = false,
            useReceipt = OrderReceipt,
        } = {}) {
        if (!this.config.evaluate_scores){
            return super.printReceipt(...arguments)
        }

        if (useReceipt === OrderReceipt2 && !order.is_sent_to_fiskaly) {
            try {
                order.bewirtungsbeleg = true;
                await this.createTransaction(order)
                await this.finishShortTransaction(order)
                order.is_sent_to_fiskaly = true;
                order.is_applicable = false;
                this.push_single_order(order);
            } catch(error) {
                console.error('An unknown error occured when sending to fiskaly', error)
            }
        }
        super.printReceipt(...arguments)
    },

    validatePoints(order) {
        let points = 0
        Object.entries(order.survey_answers).forEach(([key, value]) => {
            points += value.points
        });
        if (points < this.config.fiskaly_qualify_points) {
            order.is_applicable = true
        }
        console.log('=====', points, this.config.fiskaly_qualify_points, order.survey_answers)
    },

    async cancelTransaction(order) {
        if (order.is_sent_to_fiskaly && !this.config.evaluate_scores) {
            super.cancelTransaction()
        }
    },

    async createAndFinishOrderTransaction(lineDifference) {
    },

    async createTransaction(order) {
        await this.validatePoints(order)
        order.fiskalyUuid = uuidv4();
        order.is_sent = true;
        if (order.is_applicable && !order.bewirtungsbeleg && this.config.evaluate_scores
        ) {
            console.log('creating fake', order.is_applicable, order.bewirtungsbeleg, this.config.evaluate_scores)
            order.transactionStarted();
            return
        }
        else {
            console.log('creating real')
            order.is_sent_to_fiskaly = true;
            order.is_applicable = false;
            return super.createTransaction(order)
        }
    },

    async finishShortTransaction(order) {
        await this.validatePoints(order)
        if (order.is_applicable && !order.bewirtungsbeleg && this.config.evaluate_scores) {
            order.l10n_de_fiskaly_transaction_number = await this.retrieveTransactionNumber();
            order.l10n_de_fiskaly_time_start = new Date().toISOString().substring(0, 19).replace("T", " ");
            order.l10n_de_fiskaly_time_end = new Date().toISOString().substring(0, 19).replace("T", " ");
            // certificate_serial is now called tss_serial_number in the v2 api
            order.l10n_de_fiskaly_certificate_serial = await this.generateSerial(84);
            order.l10n_de_fiskaly_timestamp_format = 'unixTime';
            order.l10n_de_fiskaly_signature_value = await this.generateSignature(88);
            order.l10n_de_fiskaly_signature_algorithm = 'ecdsa-plain-SHA256';
            order.l10n_de_fiskaly_signature_public_key = this.l10n_de_fiskaly_signature_public_key;
            order.l10n_de_fiskaly_client_serial_number = this.l10n_de_fiskaly_client_serial_number;
            order.transactionFinished();
            return
        }
        else {
            order.is_applicable = false
            return super.finishShortTransaction(order)
        }
    },

    generateSerial(length) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'; // Allowed characters
        let result = '';
    
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    generateSignature(length) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/'; // Allowed characters
        let result = '';
    
        for (let i = 0; i < length - 2; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        result += '==';
        return result;
    },

    generateSignaturePublic(length) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/'; // Allowed characters
        let result = '';
    
        for (let i = 0; i < length - 1; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        result += '=';
        return result;
    },

    async retrieveKeys() {
        const data = await this.data.call(
            "pos.order",
            "retrieve_keys",
            [false]
        );
        return data;
    },

    async retrieveTransactionNumber() {
        const data = await this.data.call(
            "pos.order",
            "get_transaction_number",
            [false]
        );
        return data;
    }
})
