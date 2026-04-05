export interface Supplier {
  id: number;
  name: string;
  email: string;
  product_count: number;
  order_days: string;
  delivery_days?: string;
  lead_time_days: number;
  min_order_value: number;
  approval_required: number;
  send_method: string;
}

export interface GuideItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
  price_source: string;
  category_name: string;
}

export interface CartSummary {
  id: number;
  supplier_id: number;
  supplier_name: string;
  item_count: number;
  total: number;
  items: any[];
  send_method: string;
  min_order_value: number;
  approval_required: number;
}

export interface Order {
  id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  lines?: any[];
  delivery_date: string | null;
  order_note: string;
  location_id: number;
}

export interface ReceiptLine {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  ordered_qty: number;
  received_qty: number | null;
  difference: number;
  has_issue: number;
  issue_type: string | null;
  issue_notes: string | null;
  price?: number;
  subtotal?: number;
  issue_photo?: string | null;
}

export interface OdooProduct {
  id: number;
  name: string;
  uom: string;
  category_name: string;
  price: number;
}

export type Tab = 'order' | 'cart' | 'receive' | 'history';
export type Screen = 'dashboard' | 'suppliers' | 'guide' | 'cart' | 'review' | 'sent' | 'receive-list' | 'receive-check' | 'receive-issue' | 'history' | 'order-detail' | 'manage' | 'manage-guide';

export const LOCATIONS = [
  { id: 32, name: 'SSAM', key: 'SSAM' },
  { id: 22, name: 'GBM38', key: 'GBM38' },
];
