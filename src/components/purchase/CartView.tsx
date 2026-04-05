import React from 'react';
import { TrashIcon } from './Icons';
import { CartSummary, Screen } from './types';

interface CartViewProps {
  carts: CartSummary[];
  deliveryDate: string;
  setDeliveryDate: (v: string) => void;
  orderNote: string;
  setOrderNote: (v: string) => void;
  calcCartTax: (cart: CartSummary) => { net: number; taxByRate: Record<number, number>; gross: number };
  updateCartQty: (product: { product_id: number; product_name: string; product_uom: string; price: number }, qty: number, supplierId?: number) => void;
  openCartNumpad: (item: any, supplierId: number) => void;
  removeCartItem: (cartId: number, productId: number) => void;
  setReviewCart: (cart: CartSummary) => void;
  setScreen: (s: Screen) => void;
}

export default function CartView({
  carts, deliveryDate, setDeliveryDate, orderNote, setOrderNote,
  calcCartTax, updateCartQty, openCartNumpad, removeCartItem,
  setReviewCart, setScreen,
}: CartViewProps) {
  return (
    <div className="px-4 py-3 pb-20">
      {carts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#128722;</div>
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">Cart is empty</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Go to a supplier and add products.</div>
        </div>
      ) : (<>
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-2">
          <div className="flex items-center gap-3">
            <span className="text-[16px]">&#128197;</span>
            <div className="flex-1"><div className="text-[var(--fs-base)] font-semibold text-gray-900">Delivery date</div></div>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-2 py-1" />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
          <div className="text-[13px] font-semibold text-gray-900 mb-1">Order note</div>
          <textarea value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Add a note for this order..." rows={2} className="w-full text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:border-green-500" />
        </div>
        {carts.map(cart => {
          const { net } = calcCartTax(cart);
          const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;
          return (
            <div key={cart.id} className="mb-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-[11px] font-bold tracking-wide uppercase text-gray-400">{cart.supplier_name}</span>
                <div className="flex gap-1.5">
                  <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-blue-100 text-blue-800">{cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                  {cart.approval_required === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>}
                </div>
              </div>
              {belowMin && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2 text-[11px] text-amber-800">
                  <span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - net).toFixed(2)} more.
                </div>
              )}
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
                {cart.items.map((item: any) => (
                  <div key={item.id} className="py-2.5 border-b border-gray-100 last:border-0">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                        <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                      </div>
                      <div className="text-right flex-shrink-0"><div className="text-[13px] font-bold font-mono text-gray-900">&euro;{(item.quantity * item.price).toFixed(2)}</div></div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center">
                        <button onClick={() => { if (item.quantity <= 1) { removeCartItem(cart.id, item.product_id); } else { updateCartQty({ product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price }, item.quantity - 1, cart.supplier_id); } }} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">-</button>
                        <button onClick={() => openCartNumpad(item, cart.supplier_id)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">{item.quantity}</button>
                        <button onClick={() => updateCartQty({ product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price }, item.quantity + 1, cart.supplier_id)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">+</button>
                      </div>
                      <button onClick={() => removeCartItem(cart.id, item.product_id)} className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-400 active:bg-red-100"><TrashIcon /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center px-3.5 py-2 mt-2 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[12px] text-gray-500">{cart.item_count} items</span>
                <span className="text-[14px] font-bold font-mono text-gray-900">&euro;{net.toFixed(2)}</span>
              </div>
              <button onClick={() => { setReviewCart(cart); setScreen('review'); }} className="w-full mt-2 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
                Review order &rarr;
              </button>
            </div>
          );
        })}
      </>)}
    </div>
  );
}
