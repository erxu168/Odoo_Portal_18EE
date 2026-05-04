'use client';

import React from 'react';

interface PendingOrder {
  id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
}

interface ReceiveListScreenProps {
  orders: PendingOrder[];
  onOpen: (order: PendingOrder) => void;
}

export default function ReceiveListScreen({ orders, onOpen }: ReceiveListScreenProps) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Pending deliveries</div>
      {orders.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No pending deliveries</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Sent orders will appear here.</div>
        </div>
      ) : (
        orders.map((order) => (
          <button
            key={order.id}
            onClick={() => onOpen(order)}
            className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">
              {(order.supplier_name || '??').split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-gray-900">{order.supplier_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div>
            </div>
            <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">
              {order.status === 'partial' ? 'Partial' : 'Pending'}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
