'use client';

import React from 'react';
import StatusBadge from './StatusBadge';

// Kept narrow to the fields this screen actually reads; the parent passes
// its full Order objects through unchanged, TS is happy with structural typing.
interface HistoryOrder {
  id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
  total_amount: number;
  created_at: string;
}

interface OrderHistoryScreenProps {
  orders: HistoryOrder[];
  filter: string;
  onFilterChange: (filter: string) => void;
  onOpen: (order: HistoryOrder) => void;
}

const FILTER_MAP: Record<string, string[]> = {
  all: [],
  sent: ['sent'],
  delivered: ['received'],
  approval: ['pending_approval'],
  issues: ['partial'],
};

const FILTERS = ['all', 'sent', 'delivered', 'approval', 'issues'] as const;

export default function OrderHistoryScreen({ orders, filter, onFilterChange, onOpen }: OrderHistoryScreenProps) {
  const filtered = filter === 'all'
    ? orders
    : orders.filter((o) => FILTER_MAP[filter]?.includes(o.status));

  return (
    <div className="px-4 py-3">
      <div className="flex gap-1.5 overflow-x-auto pb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 capitalize ${filter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No orders yet</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
          {filtered.map((order) => (
            <button
              key={order.id}
              onClick={() => onOpen(order)}
              className="w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left active:bg-gray-50"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gray-900">{order.supplier_name}</div>
                <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                  {order.odoo_po_name || `#${order.id}`} &bull; {new Date(order.created_at).toLocaleDateString('de-DE')}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[13px] font-bold font-mono text-gray-900">&euro;{order.total_amount.toFixed(2)}</div>
                <StatusBadge status={order.status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
