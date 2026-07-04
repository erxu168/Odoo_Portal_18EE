'use client';

import React from 'react';

interface PendingOrder {
  id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
  receipt_status?: string | null;
}

interface ReceiveListScreenProps {
  orders: PendingOrder[];
  isManager: boolean;
  onOpen: (order: PendingOrder) => void;
}

function OrderRow({ order, onOpen, badge, muted }: {
  order: PendingOrder;
  onOpen: (order: PendingOrder) => void;
  badge: { text: string; className: string };
  muted?: boolean;
}) {
  return (
    <button
      key={order.id}
      data-testid="delivery-row"
      onClick={() => onOpen(order)}
      className={`w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left ${muted ? 'opacity-70' : ''}`}
    >
      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-[#F5800A] flex-shrink-0">
        {(order.supplier_name || '??').split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold text-gray-900">{order.supplier_name}</div>
        <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div>
      </div>
      <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold ${badge.className}`}>{badge.text}</span>
    </button>
  );
}

export default function ReceiveListScreen({ orders, isManager, onOpen }: ReceiveListScreenProps) {
  const toReceive = orders.filter((o) => o.receipt_status !== 'submitted');
  const awaitingApproval = orders.filter((o) => o.receipt_status === 'submitted');

  return (
    <div className="px-4 py-3">
      {awaitingApproval.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Awaiting approval</div>
          {awaitingApproval.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              onOpen={isManager ? onOpen : () => { /* staff can't approve */ }}
              muted={!isManager}
              badge={{ text: isManager ? 'Approve' : 'Waiting', className: 'bg-[#FFF4E6] text-[#F5800A]' }}
            />
          ))}
        </div>
      )}

      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">To receive</div>
      {toReceive.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No pending deliveries</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Sent orders will appear here.</div>
        </div>
      ) : (
        toReceive.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            onOpen={onOpen}
            badge={{
              text: order.status === 'partial' ? 'Partial' : 'Pending',
              className: 'bg-amber-100 text-amber-800',
            }}
          />
        ))
      )}
    </div>
  );
}
