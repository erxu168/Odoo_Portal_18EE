'use client';

import React, { useState } from 'react';
import SearchInput from './SearchInput';

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
      <span className={`text-[12px] px-3 py-1.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0 ${badge.className}`}>{badge.text}</span>
    </button>
  );
}

export default function ReceiveListScreen({ orders, isManager, onOpen }: ReceiveListScreenProps) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const match = (o: PendingOrder) =>
    !q ||
    (o.supplier_name || '').toLowerCase().includes(q) ||
    (o.odoo_po_name || '').toLowerCase().includes(q);

  const toReceive = orders.filter((o) => o.receipt_status !== 'submitted' && match(o));
  const awaitingApproval = orders.filter((o) => o.receipt_status === 'submitted' && match(o));
  const nothingMatches = !!q && toReceive.length === 0 && awaitingApproval.length === 0;

  return (
    <div className="px-4 py-3">
      {orders.length > 0 && (
        <div className="mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search deliveries by supplier…" />
        </div>
      )}

      {nothingMatches ? (
        <div className="text-center py-16">
          <div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No matches</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Nothing found for &ldquo;{search}&rdquo;.</div>
        </div>
      ) : (
        <>
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

          {(toReceive.length > 0 || !q) && (
            <>
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
                      text: order.status === 'partial' ? 'Continue receiving' : 'Start receiving',
                      className: 'bg-[#F5800A] text-white',
                    }}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
