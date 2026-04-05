import React from 'react';
import StatusBadge from './StatusBadge';
import { WarningIcon } from './Icons';
import { ReceiptLine, GuideItem } from './types';

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ReceiveCheckProps {
  recvOrder: any;
  receiptLines: ReceiptLine[];
  receipt: any;
  isManager: boolean;
  updateRecvQty: (lineId: number, qty: number) => void;
  openIssueReport: (line: ReceiptLine) => void;
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
  confirmReceiptAction: (closeOrder: boolean) => void;
  setRecvNumpadLineId: (id: number) => void;
  setCartNumpadItem: (item: any) => void;
  setNumpadProduct: (p: GuideItem | null) => void;
  setNumpadValue: (v: string) => void;
  setNumpadOpen: (v: boolean) => void;
}

export default function ReceiveCheck({
  recvOrder, receiptLines, receipt, isManager,
  updateRecvQty, openIssueReport, setConfirmDialog, confirmReceiptAction,
  setRecvNumpadLineId, setCartNumpadItem, setNumpadProduct, setNumpadValue, setNumpadOpen,
}: ReceiveCheckProps) {
  const orderTotal = recvOrder?.total_amount || 0;

  const openRecvNumpad = (line: ReceiptLine) => {
    setRecvNumpadLineId(line.id);
    setCartNumpadItem(null);
    setNumpadProduct({ id: 0, product_id: line.product_id, product_name: line.product_name, product_uom: line.product_uom, price: line.price || 0, price_source: '', category_name: '' });
    setNumpadValue(line.received_qty !== null ? String(line.received_qty) : '');
    setNumpadOpen(true);
  };

  return (
    <div className="px-4 py-3 pb-56">
      {recvOrder && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-[14px] font-bold text-gray-900">{recvOrder.supplier_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{recvOrder.odoo_po_name || `#${recvOrder.id}`}</div>
            </div>
            <StatusBadge status={recvOrder.status} />
          </div>
          <div className="text-[11px] text-gray-500">Ordered by <span className="font-semibold text-gray-900">{recvOrder.ordered_by_name}</span></div>
          <div className="text-[11px] text-gray-500">{new Date(recvOrder.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          {recvOrder.delivery_date && <div className="text-[11px] text-gray-500">Delivery: {recvOrder.delivery_date}</div>}
          {recvOrder.order_note && <div className="text-[11px] text-gray-500 mt-1 italic">{recvOrder.order_note}</div>}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
            <span className="text-[11px] text-gray-400">{receiptLines.length} items</span>
            <span className="text-[14px] font-bold font-mono text-gray-900">&euro;{orderTotal.toFixed(2)}</span>
          </div>
        </div>
      )}
      <p className="text-[12px] text-gray-500 mb-3">Enter the quantity you actually received. Leave blank if not delivered yet.</p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {receiptLines.map(line => {
          const qty = line.received_qty;
          const linePrice = line.price || 0;
          return (
            <div key={line.id} className="py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900">{line.product_name}</div>
                  <div className="text-[11px] text-gray-500 font-mono">Ordered: {line.ordered_qty} {line.product_uom}{linePrice > 0 ? ` \u00b7 \u20ac${linePrice.toFixed(2)}/${line.product_uom}` : ''}</div>
                  {linePrice > 0 && <div className="text-[10px] text-gray-400 font-mono">Subtotal: &euro;{(line.ordered_qty * linePrice).toFixed(2)}</div>}
                  {line.has_issue === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-red-100 text-red-800 mt-1 inline-block">{line.issue_type || 'Issue'}</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {qty !== null && qty > 0 ? (
                    <div className="flex items-center">
                      <button onClick={() => updateRecvQty(line.id, Math.max(0, (qty || 0) - 1))} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">-</button>
                      <button onClick={() => openRecvNumpad(line)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">{qty}</button>
                      <button onClick={() => updateRecvQty(line.id, (qty || 0) + 1)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">+</button>
                    </div>
                  ) : (
                    <button onClick={() => openRecvNumpad(line)} className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-500 active:bg-gray-100 font-mono">{qty === null ? 'Enter qty' : '0'}</button>
                  )}
                  {qty !== null && qty === line.ordered_qty && <span className="text-green-500 text-[15px]">&#10003;</span>}
                  {qty !== null && qty !== line.ordered_qty && qty < line.ordered_qty && <span className="text-red-600 text-[11px] font-bold font-mono">{line.difference}</span>}
                  <button onClick={() => openIssueReport(line)} className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:bg-red-100 ${line.has_issue ? 'bg-red-100' : 'bg-amber-50'}`}><WarningIcon color={line.has_issue ? '#DC2626' : '#D97706'} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {isManager ? (<>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setConfirmDialog({ title: 'Confirm receipt?', message: 'This will update stock quantities in Odoo and close this order. This cannot be undone.', confirmLabel: 'Yes, confirm & close', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(true); } })} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Confirm &amp; close</button>
            <button onClick={() => setConfirmDialog({ title: 'Keep as backorder?', message: 'Received quantities will be updated in Odoo. The remaining items will stay open for a future delivery.', confirmLabel: 'Yes, keep backorder', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(false); } })} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep as backorder</button>
          </div>
          <p className="text-[11px] text-gray-400 text-center">Confirming will update stock in Odoo.</p>
        </>) : (
          <p className="text-[12px] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>
        )}
      </div>
    </div>
  );
}
