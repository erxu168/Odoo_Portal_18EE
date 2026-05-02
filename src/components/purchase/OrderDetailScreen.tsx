'use client';

import React from 'react';
import StatusBadge from './StatusBadge';

// Full Order shape — callbacks pass the whole thing through to reorderPastOrder
// (which reads .lines) and cancelSelectedOrder.
interface OrderLine {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  quantity: number;
  price: number;
  subtotal: number;
}
interface Order {
  id: number;
  supplier_id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
  total_amount: number;
  created_at: string;
  lines?: OrderLine[];
  delivery_date: string | null;
  order_note: string;
  location_id: number;
  sent_at?: string | null;
  cancelled_at?: string | null;
  receipt_created_at?: string | null;
  receipt_confirmed_at?: string | null;
  approved_by?: number | null;
}

interface OrderDetailScreenProps {
  order: Order | null;
  reordering: boolean;
  onReorder: (order: Order) => void;
  onCancel: (order: Order) => void;
}

type StepState = 'done' | 'current' | 'pending' | 'skipped';

function fmt(iso: string | null | undefined): string | null {
  return iso
    ? new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
}

function buildTimelineSteps(order: Order) {
  const isCancelled = order.status === 'cancelled';
  const steps: { key: string; label: string; at: string | null; state: StepState; tint?: 'danger' }[] = [];

  steps.push({ key: 'ordered', label: 'Ordered', at: fmt(order.created_at), state: 'done' });

  if (order.status === 'pending_approval') {
    steps.push({ key: 'approval', label: 'Awaiting approval', at: null, state: 'current' });
  } else if (order.approved_by || ['approved', 'sent', 'received', 'partial'].includes(order.status)) {
    steps.push({ key: 'approved', label: 'Approved', at: null, state: 'done' });
  }

  steps.push({
    key: 'sent',
    label: 'Sent to supplier',
    at: fmt(order.sent_at),
    state: order.sent_at ? 'done' : isCancelled ? 'skipped' : order.status === 'approved' ? 'current' : 'pending',
  });

  const deliveredAt =
    order.receipt_confirmed_at || (['received', 'partial'].includes(order.status) ? order.receipt_created_at : null);
  const deliveredState: StepState =
    order.receipt_confirmed_at || ['received', 'partial'].includes(order.status)
      ? 'done'
      : isCancelled
      ? 'skipped'
      : order.sent_at
      ? 'current'
      : 'pending';
  const deliveredLabel = order.status === 'partial' ? 'Partially delivered' : 'Delivered';
  steps.push({ key: 'delivered', label: deliveredLabel, at: fmt(deliveredAt), state: deliveredState });

  if (isCancelled) {
    steps.push({ key: 'cancelled', label: 'Cancelled', at: fmt(order.cancelled_at), state: 'done', tint: 'danger' });
  }
  return steps;
}

export default function OrderDetailScreen({ order, reordering, onReorder, onCancel }: OrderDetailScreenProps) {
  if (!order) return null;
  const canCancel = ['draft', 'pending_approval', 'approved'].includes(order.status);
  const steps = buildTimelineSteps(order);

  return (
    <div className="px-4 py-3">
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="text-[16px] font-bold text-gray-900">{order.supplier_name}</div>
            <div className="text-[12px] text-gray-500 font-mono mt-1">{order.odoo_po_name || `#${order.id}`}</div>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="text-[12px] text-gray-500 mb-1">
          Ordered: {new Date(order.created_at).toLocaleString('de-DE')}
        </div>
        {order.delivery_date && <div className="text-[12px] text-gray-500">Delivery: {order.delivery_date}</div>}
        {order.order_note && <div className="text-[12px] text-gray-500 mt-1">Note: {order.order_note}</div>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Delivery timeline</div>
        <div className="relative">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const dotCls =
              step.tint === 'danger'
                ? 'bg-red-500 border-red-500 text-white'
                : step.state === 'done'
                ? 'bg-green-500 border-green-500 text-white'
                : step.state === 'current'
                ? 'bg-white border-blue-500 text-blue-500 ring-4 ring-blue-100'
                : step.state === 'skipped'
                ? 'bg-gray-100 border-gray-200 text-gray-300'
                : 'bg-white border-gray-300 text-gray-300';
            const connectorCls =
              step.state === 'done' ? 'bg-green-300' : step.state === 'skipped' ? 'bg-gray-100' : 'bg-gray-200';
            return (
              <div key={step.key} className="flex gap-3 relative">
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${dotCls}`}>
                    {step.state === 'done' && step.tint !== 'danger' && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                    {step.tint === 'danger' && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    )}
                    {step.state === 'current' && <div className="w-2 h-2 bg-blue-500 rounded-full" />}
                  </div>
                  {!isLast && <div className={`w-0.5 flex-1 min-h-[22px] ${connectorCls}`} />}
                </div>
                <div className={`flex-1 pb-4 ${isLast ? 'pb-0' : ''}`}>
                  <div
                    className={`text-[13px] font-semibold ${
                      step.state === 'skipped'
                        ? 'text-gray-300 line-through'
                        : step.tint === 'danger'
                        ? 'text-red-700'
                        : step.state === 'pending'
                        ? 'text-gray-400'
                        : 'text-gray-900'
                    }`}
                  >
                    {step.label}
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    {step.at || (step.state === 'current' ? 'In progress' : step.state === 'skipped' ? '—' : 'Pending')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {order.lines && order.lines.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-3">
          {order.lines.map((line) => (
            <div key={line.id} className="flex justify-between py-2.5 border-b border-gray-100 last:border-0 text-[13px]">
              <div className="text-gray-900">{line.product_name}</div>
              <div className="font-mono text-gray-500">
                {line.quantity} {line.product_uom} &bull; &euro;{line.subtotal.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-right text-[16px] font-bold font-mono text-gray-900 mb-4">
        &euro;{order.total_amount.toFixed(2)}
      </div>

      {order.lines && order.lines.length > 0 && (
        <button
          onClick={() => onReorder(order)}
          disabled={reordering}
          className="w-full py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold shadow-sm active:bg-green-700 disabled:opacity-50 mb-2"
        >
          {reordering ? 'Adding to cart...' : 'Reorder these items'}
        </button>
      )}

      {canCancel && (
        <button
          onClick={() => onCancel(order)}
          className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100"
        >
          Cancel order
        </button>
      )}
    </div>
  );
}
