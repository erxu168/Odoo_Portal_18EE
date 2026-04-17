'use client';

import React from 'react';

interface CartItem {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  quantity: number;
  price: number;
}

interface CartSummary {
  id: number;
  supplier_id: number;
  supplier_name: string;
  item_count: number;
  total: number;
  items: CartItem[];
  send_method: string;
  min_order_value: number;
  approval_required: number;
}

interface CartTax {
  net: number;
  taxByRate: Record<number, number>;
  gross: number;
}

interface ProductRef {
  product_id: number;
  product_name: string;
  product_uom: string;
  price: number;
}

interface CartViewScreenProps {
  carts: CartSummary[];
  deliveryDate: string;
  orderNote: string;
  onDeliveryDateChange: (v: string) => void;
  onOrderNoteChange: (v: string) => void;
  calcTax: (cart: CartSummary) => CartTax;
  onUpdateQty: (product: ProductRef, qty: number, supplierId: number) => void;
  onOpenNumpad: (item: CartItem, supplierId: number) => void;
  onRemoveItem: (cartId: number, productId: number) => void;
  onReview: (cart: CartSummary) => void;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

export default function CartViewScreen({
  carts,
  deliveryDate,
  orderNote,
  onDeliveryDateChange,
  onOrderNoteChange,
  calcTax,
  onUpdateQty,
  onOpenNumpad,
  onRemoveItem,
  onReview,
}: CartViewScreenProps) {
  if (carts.length === 0) {
    return (
      <div className="px-4 py-3 pb-20">
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#128722;</div>
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">Cart is empty</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Go to a supplier and add products.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 pb-20">
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-2">
        <div className="flex items-center gap-3">
          <span className="text-[16px]">&#128197;</span>
          <div className="flex-1">
            <div className="text-[var(--fs-base)] font-semibold text-gray-900">Delivery date</div>
          </div>
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => onDeliveryDateChange(e.target.value)}
            className="text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-2 py-1"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
        <div className="text-[13px] font-semibold text-gray-900 mb-1">Order note</div>
        <textarea
          value={orderNote}
          onChange={(e) => onOrderNoteChange(e.target.value)}
          placeholder="Add a note for this order..."
          rows={2}
          className="w-full text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:border-green-500"
        />
      </div>

      {carts.map((cart) => {
        const { net } = calcTax(cart);
        const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;
        return (
          <div key={cart.id} className="mb-4">
            <div className="flex justify-between items-center py-2">
              <span className="text-[11px] font-bold tracking-wide uppercase text-gray-400">{cart.supplier_name}</span>
              <div className="flex gap-1.5">
                <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-blue-100 text-blue-800">
                  {cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}
                </span>
                {cart.approval_required === 1 && (
                  <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>
                )}
              </div>
            </div>

            {belowMin && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2 text-[11px] text-amber-800">
                <span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - net).toFixed(2)} more.
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {cart.items.map((item) => (
                <div key={item.id} className="py-2.5 border-b border-gray-100 last:border-0">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[13px] font-bold font-mono text-gray-900">&euro;{(item.quantity * item.price).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center">
                      <button
                        onClick={() => {
                          if (item.quantity <= 1) {
                            onRemoveItem(cart.id, item.product_id);
                          } else {
                            onUpdateQty(
                              { product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price },
                              item.quantity - 1,
                              cart.supplier_id
                            );
                          }
                        }}
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100"
                      >
                        -
                      </button>
                      <button onClick={() => onOpenNumpad(item, cart.supplier_id)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">
                        {item.quantity}
                      </button>
                      <button
                        onClick={() =>
                          onUpdateQty(
                            { product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price },
                            item.quantity + 1,
                            cart.supplier_id
                          )
                        }
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => onRemoveItem(cart.id, item.product_id)}
                      className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-400 active:bg-red-100"
                      aria-label="Remove item"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center px-3.5 py-2 mt-2 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-[12px] text-gray-500">{cart.item_count} items</span>
              <span className="text-[14px] font-bold font-mono text-gray-900">&euro;{net.toFixed(2)}</span>
            </div>

            <button
              onClick={() => onReview(cart)}
              className="w-full mt-2 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all"
            >
              Review order &rarr;
            </button>
          </div>
        );
      })}
    </div>
  );
}
