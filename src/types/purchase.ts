/**
 * Purchase Module — TypeScript Types
 * Maps to Odoo models: purchase.list, purchase.list.line, purchase.order
 */

export interface Supplier {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  minOrderValue: number;
  deliveryDays: string;
  category: string;
}

export interface PurchaseGuide {
  id: number;
  name: string;
  supplier: Supplier;
  lineCount: number;
  lines: PurchaseGuideLine[];
}

export interface PurchaseGuideLine {
  id: number;
  productId: number;
  productName: string;
  defaultCode: string;
  defaultQty: number;
  uom: string;
  uomId: number;
  priceUnit: number;
  partnerId: number | false;
  partnerName: string;
  sequence: number;
  lastOrderQty?: number;
}

export interface PurchaseOrder {
  id: number;
  name: string;
  partnerId: number;
  partnerName: string;
  state: 'draft' | 'sent' | 'purchase' | 'done' | 'cancel';
  dateOrder: string;
  datePlanned: string;
  amountTotal: number;
  amountUntaxed: number;
  currencySymbol: string;
  origin: string;
  lineCount: number;
  receiptStatus: 'pending' | 'received' | 'no_receipt';
  deliveryChecked: boolean;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
  id: number;
  productId: number;
  productName: string;
  productQty: number;
  productUom: string;
  priceUnit: number;
  priceSubtotal: number;
}

// Screen navigation types (same pattern as manufacturing)
export type PurchaseScreen =
  | { type: 'guide-list' }
  | { type: 'guide-order'; guideId: number; supplierId: number }
  | { type: 'review'; guideId: number }
  | { type: 'order-list' }
  | { type: 'order-detail'; orderId: number }
  | { type: 'receive-list' }
  | { type: 'receive-detail'; orderId: number };
