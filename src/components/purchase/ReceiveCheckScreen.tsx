'use client';

import React from 'react';
import FilePicker from '@/components/ui/FilePicker';
import StatusBadge from './StatusBadge';

// Mirrors the full ReceiptLine shape from page.tsx so callbacks that need the
// whole object (openIssueReport, openRecvNumpadForLine) stay assignable.
interface ReceiptLine {
  id: number;
  product_id: number;
  product_name: string;
  product_uom: string;
  ordered_qty: number;
  received_qty: number | null;
  difference: number;
  has_issue: number;
  issue_type: string | null;
  issue_notes: string | null;
  price?: number;
  subtotal?: number;
  issue_photo?: string | null;
}

// The receive endpoint enriches the order with `ordered_by_name`, which isn't
// on the plain Order shape — keep this interface local to avoid churn.
interface RecvOrder {
  id: number;
  supplier_name: string;
  odoo_po_name: string | null;
  status: string;
  total_amount: number;
  ordered_by_name?: string;
  created_at: string;
  delivery_date?: string | null;
  order_note?: string;
}

interface ReceiveCheckScreenProps {
  order: RecvOrder | null;
  lines: ReceiptLine[];
  isManager: boolean;

  // Delivery note (staff capture) + submit / manager approve
  isSubmitted: boolean;            // receipt already submitted -> manager approval mode
  deliveryPhotos: string[];        // captured photos (data URLs), capture mode only
  submitting: boolean;
  onAddPhoto: (dataUrl: string) => void;
  onRemovePhoto: (index: number) => void;
  onSubmit: () => void;            // staff: submit for approval
  onViewNote: () => void;          // view the delivery-note PDF

  // Per-line actions
  onUpdateQty: (lineId: number, qty: number) => void;
  onOpenNumpad: (line: ReceiptLine) => void;
  onReportIssue: (line: ReceiptLine) => void;

  // Bottom action bar (manager approve)
  onConfirmClose: () => void;
  onKeepBackorder: () => void;
}

function WarningIcon({ color = '#D97706' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

export default function ReceiveCheckScreen({
  order,
  lines,
  isManager,
  isSubmitted,
  deliveryPhotos,
  submitting,
  onAddPhoto,
  onRemovePhoto,
  onSubmit,
  onViewNote,
  onUpdateQty,
  onOpenNumpad,
  onReportIssue,
  onConfirmClose,
  onKeepBackorder,
}: ReceiveCheckScreenProps) {
  const orderTotal = order?.total_amount || 0;

  return (
    <div className="px-4 py-3 pb-56">
      {order && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-[14px] font-bold text-gray-900">{order.supplier_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div>
            </div>
            <StatusBadge status={order.status} />
          </div>
          {order.ordered_by_name && (
            <div className="text-[11px] text-gray-500">
              Ordered by <span className="font-semibold text-gray-900">{order.ordered_by_name}</span>
            </div>
          )}
          <div className="text-[11px] text-gray-500">
            {new Date(order.created_at).toLocaleDateString('de-DE', {
              day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
          {order.delivery_date && <div className="text-[11px] text-gray-500">Delivery: {order.delivery_date}</div>}
          {order.order_note && <div className="text-[11px] text-gray-500 mt-1 italic">{order.order_note}</div>}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
            <span className="text-[11px] text-gray-400">{lines.length} items</span>
            <span className="text-[14px] font-bold font-mono text-gray-900">&euro;{orderTotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      <p className="text-[12px] text-gray-500 mb-3">
        {isSubmitted
          ? 'Delivery submitted. Review the quantities and the attached delivery note.'
          : 'Enter the quantity you actually received. Leave blank if not delivered yet.'}
      </p>

      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {lines.map((line) => {
          const qty = line.received_qty;
          const linePrice = line.price || 0;
          return (
            <div key={line.id} className="py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-center gap-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900">{line.product_name}</div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    Ordered: {line.ordered_qty} {line.product_uom}
                    {linePrice > 0 && ` · €${linePrice.toFixed(2)}/${line.product_uom}`}
                  </div>
                  {linePrice > 0 && (
                    <div className="text-[10px] text-gray-400 font-mono">
                      Subtotal: &euro;{(line.ordered_qty * linePrice).toFixed(2)}
                    </div>
                  )}
                  {line.has_issue === 1 && (
                    <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-red-100 text-red-800 mt-1 inline-block">
                      {line.issue_type || 'Issue'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {qty !== null && qty > 0 ? (
                    <div className="flex items-center">
                      <button onClick={() => onUpdateQty(line.id, Math.max(0, (qty || 0) - 1))} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">-</button>
                      <button onClick={() => onOpenNumpad(line)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">{qty}</button>
                      <button onClick={() => onUpdateQty(line.id, (qty || 0) + 1)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">+</button>
                    </div>
                  ) : (
                    <button onClick={() => onOpenNumpad(line)} className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-500 active:bg-gray-100 font-mono">
                      {qty === null ? 'Enter qty' : '0'}
                    </button>
                  )}
                  {qty !== null && qty === line.ordered_qty && <span className="text-green-500 text-[15px]">&#10003;</span>}
                  {qty !== null && qty !== line.ordered_qty && qty < line.ordered_qty && (
                    <span className="text-red-600 text-[11px] font-bold font-mono">{line.difference}</span>
                  )}
                  <button
                    onClick={() => onReportIssue(line)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:bg-red-100 ${line.has_issue ? 'bg-red-100' : 'bg-amber-50'}`}
                  >
                    <WarningIcon color={line.has_issue ? '#DC2626' : '#D97706'} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {isSubmitted ? (
          isManager ? (
            <>
              <button onClick={onViewNote} className="w-full mb-2 py-2.5 rounded-xl bg-[#FFF4E6] border border-[#F5800A] text-[#F5800A] text-[13px] font-bold active:bg-[#ffe9cc]">View delivery note</button>
              <div className="flex gap-2">
                <button onClick={onConfirmClose} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Approve &amp; close</button>
                <button onClick={onKeepBackorder} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep backorder</button>
              </div>
              <p className="text-[11px] text-gray-400 text-center mt-1">Approving updates stock in Odoo.</p>
            </>
          ) : (
            <>
              <button onClick={onViewNote} className="w-full mb-2 py-2.5 rounded-xl bg-[#FFF4E6] border border-[#F5800A] text-[#F5800A] text-[13px] font-bold active:bg-[#ffe9cc]">View delivery note</button>
              <p className="text-[12px] text-gray-500 text-center py-1">Submitted &mdash; waiting for a manager to approve.</p>
            </>
          )
        ) : (
          <>
            <div className="mb-2">
              <FilePicker
                onFile={(_file, dataUrl) => onAddPhoto(dataUrl)}
                accept="image/*"
                variant="button"
                icon={'\u{1F4F7}'}
                label="Add delivery note photo"
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#F5800A] text-white active:bg-[#E86000]"
              />
              {deliveryPhotos.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto">
                  {deliveryPhotos.map((src, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img src={src} alt={`note ${i + 1}`} className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                      <button onClick={() => onRemovePhoto(i)} aria-label="Remove" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-[11px] leading-none">&times;</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onSubmit}
              disabled={deliveryPhotos.length === 0 || submitting}
              className={`w-full py-3 rounded-xl text-[14px] font-bold ${deliveryPhotos.length === 0 || submitting ? 'bg-gray-200 text-gray-400' : 'bg-green-600 text-white active:bg-green-700'}`}
            >
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-1">A manager approves before stock updates.</p>
          </>
        )}
      </div>
    </div>
  );
}
