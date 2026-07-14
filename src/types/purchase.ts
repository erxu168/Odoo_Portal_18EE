/**
 * Purchase module types.
 * Covers suppliers, order guides, carts, orders, receipts.
 */

// === Portal-managed supplier (subset of Odoo res.partner) ===
export interface PurchaseSupplier {
  id: number;
  odoo_partner_id: number;
  name: string;
  email: string;           // order email (portal-configured)
  phone: string;
  send_method: 'email' | 'whatsapp';
  whatsapp_number: string;
  min_order_value: number; // 0 = no minimum
  order_days: string;      // JSON array e.g. '["mon","thu"]' — days orders must be placed by
  delivery_days: string;   // JSON array e.g. '["wed","thu"]' — days supplier actually delivers
  lead_time_days: number;  // business days between order cutoff and delivery
  approval_required: number; // 0 or 1
  location_id: number;     // which Odoo stock.location this supplier serves
  active: number;
  created_at: string;
}

// === Order guide (product list per supplier per location) ===
export interface OrderGuide {
  id: number;
  supplier_id: number;     // FK to purchase_suppliers
  location_id: number;     // Odoo stock.location.id (Ssam=32, Krawi=22)
  name: string;
  created_at: string;
}

export interface GuideItem {
  id: number;
  guide_id: number;
  product_id: number;      // Odoo product.product.id
  product_name: string;
  product_uom: string;
  price: number;           // per UoM
  price_source: 'odoo' | 'manual';
  sort_order: number;
  category_name: string;
}

// === Shared cart (per location) ===
export interface Cart {
  id: number;
  location_id: number;
  supplier_id: number;
  status: 'draft' | 'submitted';
  created_by: number;      // portal user id
  updated_at: string;
  created_at: string;
}

export interface CartItem {
  id: number;
  cart_id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  quantity: number;
  price: number;
  added_by: number;        // portal user id who added/last changed
  updated_at: string;
}

// === Purchase order (mirrors Odoo PO) ===
export interface PurchaseOrder {
  id: number;
  odoo_po_id: number | null;  // Odoo purchase.order.id once created
  odoo_po_name: string | null; // e.g. P00042
  supplier_id: number;
  location_id: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'received' | 'partial' | 'cancelled';
  delivery_date: string | null;
  order_note: string;
  total_amount: number;
  ordered_by: number;       // portal user id
  approved_by: number | null;
  sent_at: string | null;
  created_at: string;
}

export interface PurchaseOrderLine {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  quantity: number;
  price: number;
  subtotal: number;
}

// === Receipt (delivery received) ===
export interface Receipt {
  id: number;
  order_id: number;
  status: 'pending' | 'confirmed' | 'partial';
  received_by: number;      // portal user id
  confirmed_by: number | null; // manager who confirmed
  delivery_note_photo: string | null; // base64 or file path
  notes: string;
  created_at: string;
  confirmed_at: string | null;
}

export interface ReceiptLine {
  id: number;
  receipt_id: number;
  order_line_id: number;
  product_id: number;
  product_name: string;
  ordered_qty: number;
  received_qty: number | null;
  difference: number;
  has_issue: number; // 0 or 1
  issue_type: string | null;
  issue_photo: string | null;
  issue_notes: string | null;
}

// === Location mapping ===
export const LOCATIONS = {
  SSAM:  { id: 32, name: 'SSAM', picking_type_id: 15, company_id: 3 },
  GBM38: { id: 22, name: 'GBM38', picking_type_id: 8, company_id: 2 },
} as const;

export type LocationKey = keyof typeof LOCATIONS;
