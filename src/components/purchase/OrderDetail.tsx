import React from 'react';
import StatusBadge from './StatusBadge';
import { Order } from './types';

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface OrderDetailProps {
  selectedOrder: Order | null;
  setConfirmDialog: (d: ConfirmDialogState | null) => void;
  cancelSelectedOrder: () => void;
}

export default function OrderDetail({ selectedOrder, setConfirmDialog, cancelSelectedOrder }: OrderDetailProps) {
  if (!selectedOrder) return null;
  const canCancel = ['draft', 'pending_approval', 'approved'].includes(selectedOrder.status);

  return (
    <div className="px-4 py-3">
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="text-[16px] font-bold text-gray-900">{selectedOrder.supplier_name}</div>
            <div className="text-[12px] text-gray-500 font-mono mt-1">{selectedOrder.odoo_po_name || `#${selectedOrder.id}`}</div>
          </div>
          <StatusBadge status={selectedOrder.status} />
        </div>
        <div className="text-[12px] text-gray-500 mb-1">Ordered: {new Date(selectedOrder.created_at).toLocaleString('de-DE')}</div>
        {selectedOrder.delivery_date && <div className="text-[12px] text-gray-500">Delivery: {selectedOrder.delivery_date}</div>}
        {selectedOrder.order_note && <div className="text-[12px] text-gray-500 mt-1">Note: {selectedOrder.order_note}</div>}
      </div>
      {selectedOrder.lines && selectedOrder.lines.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-3">
          {selectedOrder.lines.map((line: any) => (
            <div key={line.id} className="flex justify-between py-2.5 border-b border-gray-100 last:border-0 text-[13px]">
              <div className="text-gray-900">{line.product_name}</div>
              <div className="font-mono text-gray-500">{line.quantity} {line.product_uom} &bull; &euro;{line.subtotal.toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="text-right text-[16px] font-bold font-mono text-gray-900 mb-4">&euro;{selectedOrder.total_amount.toFixed(2)}</div>
      {canCancel && (
        <button
          onClick={() => setConfirmDialog({
            title: 'Cancel this order?',
            message: `Are you sure you want to cancel this order to ${selectedOrder.supplier_name}? This cannot be undone.`,
            confirmLabel: 'Yes, cancel order',
            variant: 'danger',
            onConfirm: () => { setConfirmDialog(null); cancelSelectedOrder(); },
          })}
          className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100"
        >
          Cancel order
        </button>
      )}
    </div>
  );
}
