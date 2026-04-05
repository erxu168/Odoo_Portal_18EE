import React from 'react';
import StatusBadge from './StatusBadge';
import { Order } from './types';

interface HistoryViewProps {
  orders: Order[];
  historyFilter: string;
  setHistoryFilter: (v: string) => void;
  openOrderDetail: (order: Order) => void;
}

export default function HistoryView({ orders, historyFilter, setHistoryFilter, openOrderDetail }: HistoryViewProps) {
  const fm: Record<string, string[]> = { all: [], sent: ['sent'], delivered: ['received'], approval: ['pending_approval'], issues: ['partial'] };
  const filtered = historyFilter === 'all' ? orders : orders.filter(o => fm[historyFilter]?.includes(o.status));

  return (
    <div className="px-4 py-3">
      <div className="flex gap-1.5 overflow-x-auto pb-3">
        {['all', 'sent', 'delivered', 'approval', 'issues'].map(f => (
          <button key={f} onClick={() => setHistoryFilter(f)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 capitalize ${historyFilter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{f}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-16"><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No orders yet</div></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
          {filtered.map(order => (
            <button key={order.id} onClick={() => openOrderDetail(order)} className="w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left active:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gray-900">{order.supplier_name}</div>
                <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`} &bull; {new Date(order.created_at).toLocaleDateString('de-DE')}</div>
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
