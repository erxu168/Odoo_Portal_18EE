import React from 'react';
import { CartSummary } from './types';

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ReviewOrderProps {
  reviewCart: CartSummary | null;
  deliveryDate: string;
  orderNote: string;
  locName: string;
  sending: boolean;
  calcCartTax: (cart: CartSummary) => { net: number; taxByRate: Record<number, number>; gross: number };
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
  sendOrder: (cart: CartSummary) => void;
}

export default function ReviewOrder({
  reviewCart, deliveryDate, orderNote, locName, sending,
  calcCartTax, setConfirmDialog, sendOrder,
}: ReviewOrderProps) {
  if (!reviewCart) return null;
  const cart = reviewCart;
  const { net, taxByRate, gross } = calcCartTax(cart);
  const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;

  return (
    <div className="px-4 py-3 pb-44">
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
        <div className="flex justify-between items-start mb-2">
          <div className="text-[15px] font-bold text-gray-900">{cart.supplier_name}</div>
          <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-blue-100 text-blue-800">{cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
        </div>
        {deliveryDate && <div className="text-[12px] text-gray-500">Delivery: {deliveryDate}</div>}
        {orderNote && <div className="text-[12px] text-gray-500 mt-1 italic">{orderNote}</div>}
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
          <span className="text-[11px] text-gray-400">{cart.item_count} items &bull; {locName}</span>
          {cart.approval_required === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>}
        </div>
      </div>
      {belowMin && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-3 text-[11px] text-amber-800">
          <span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - net).toFixed(2)} more.
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {cart.items.map((item: any) => (
          <div key={item.id} className="flex justify-between items-start py-3 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0 pr-3">
              <div className="text-[13px] font-semibold text-gray-900">{item.product_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{item.quantity} {item.product_uom} &times; &euro;{item.price.toFixed(2)}</div>
            </div>
            <div className="text-[13px] font-bold font-mono text-gray-900 flex-shrink-0">&euro;{(item.quantity * item.price).toFixed(2)}</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-50 rounded-xl px-3.5 py-2.5 mt-2 border border-gray-100">
        <div className="flex justify-between text-[12px] text-gray-500"><span>Subtotal (net)</span><span className="font-mono">&euro;{net.toFixed(2)}</span></div>
        {Object.entries(taxByRate).sort(([a],[b]) => Number(a)-Number(b)).map(([r, amt]) => (
          <div key={r} className="flex justify-between text-[11px] text-gray-400"><span>{r}% MwSt</span><span className="font-mono">&euro;{(amt as number).toFixed(2)}</span></div>
        ))}
        <div className="flex justify-between text-[14px] font-bold text-gray-900 pt-1 border-t border-gray-200 mt-1"><span>Total (gross)</span><span className="font-mono">&euro;{gross.toFixed(2)}</span></div>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        <button onClick={() => {
          const msg = belowMin
            ? `This order (\u20ac${net.toFixed(2)} net) is below the minimum of \u20ac${cart.min_order_value.toFixed(2)}. Send anyway to ${cart.supplier_name}?`
            : `Send ${cart.item_count} items (\u20ac${gross.toFixed(2)} incl. tax) to ${cart.supplier_name}?`;
          setConfirmDialog({ title: belowMin ? 'Below minimum order' : 'Send order?', message: msg, confirmLabel: belowMin ? 'Send anyway' : 'Yes, send order', variant: 'primary', onConfirm: () => { setConfirmDialog(null); sendOrder(cart); } });
        }} disabled={sending} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50 active:scale-[0.975] transition-all">
          {sending ? 'Sending...' : `Send to ${cart.supplier_name.split(' ')[0]} \u2192`}
        </button>
        {cart.approval_required === 1 && <p className="text-[11px] text-amber-600 text-center mt-1.5">This order requires manager approval before sending.</p>}
      </div>
    </div>
  );
}
