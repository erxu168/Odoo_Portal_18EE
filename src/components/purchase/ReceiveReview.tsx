'use client';

import React, { useState } from 'react';
import FilePicker from "@/components/ui/FilePicker";

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

interface ReceiveReviewProps {
  receiptLines: ReceiptLine[];
  checkedLines: Record<number, boolean>;
  onToggleCheck: (lineId: number) => void;
  recvOrder: any;
  receipt: any;
  isManager: boolean;
  onConfirm: (closeOrder: boolean, deliveryNotePhoto?: string) => void;
  onBack: () => void;
  onSetConfirmDialog: (dialog: any) => void;
}

export default function ReceiveReview({
  receiptLines,
  checkedLines,
  onToggleCheck,
  recvOrder,
  receipt,
  isManager,
  onConfirm,
  onBack,
  onSetConfirmDialog,
}: ReceiveReviewProps) {
  const [deliveryNotePhoto, setDeliveryNotePhoto] = useState('');
  const [managerConfirmed, setManagerConfirmed] = useState(false);

  const totalLines = receiptLines.length;
  const checkedCount = receiptLines.filter(l => checkedLines[l.id]).length;
  const allChecked = totalLines > 0 && checkedCount === totalLines;
  const progressPct = totalLines > 0 ? Math.round((checkedCount / totalLines) * 100) : 0;

  const linesWithQty = receiptLines.filter(l => l.received_qty !== null && l.received_qty > 0);
  const linesNotReceived = receiptLines.filter(l => l.received_qty === null || l.received_qty === 0);
  const linesWithIssues = receiptLines.filter(l => l.has_issue === 1);
  const linesShort = receiptLines.filter(l => l.received_qty !== null && l.received_qty < l.ordered_qty && l.has_issue !== 1);
  const linesOver = receiptLines.filter(l => l.received_qty !== null && l.received_qty > l.ordered_qty);

  const receivedTotal = linesWithQty.reduce((sum, l) => sum + (l.received_qty || 0) * (l.price || 0), 0);
  const orderedTotal = receiptLines.reduce((sum, l) => sum + l.ordered_qty * (l.price || 0), 0);

  function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDeliveryNotePhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  const canConfirm = allChecked && (isManager ? managerConfirmed : false);

  return (
    <div className="px-4 py-3 pb-52">
      {/* Progress bar */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[var(--fs-sm)] font-bold text-gray-900">Inspection progress</span>
          <span className="text-[var(--fs-xs)] font-mono font-bold text-gray-900">{checkedCount}/{totalLines}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${allChecked ? 'bg-green-500' : 'bg-green-600'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {!allChecked && (
          <p className="text-[var(--fs-xs)] text-amber-600 mt-2">
            Check each item to confirm it has been inspected.
          </p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <div className="text-[var(--fs-xxl)] font-extrabold font-mono text-gray-900">{linesWithQty.length}</div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Received</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <div className="text-[var(--fs-xxl)] font-extrabold font-mono text-red-600">{linesNotReceived.length}</div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Not delivered</div>
        </div>
      </div>
      {(linesWithIssues.length > 0 || linesShort.length > 0 || linesOver.length > 0) && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {linesWithIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-center">
              <div className="text-[var(--fs-lg)] font-bold font-mono text-red-700">{linesWithIssues.length}</div>
              <div className="text-[9px] font-semibold text-red-500 uppercase tracking-wide">Issues</div>
            </div>
          )}
          {linesShort.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-center">
              <div className="text-[var(--fs-lg)] font-bold font-mono text-amber-700">{linesShort.length}</div>
              <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-wide">Short</div>
            </div>
          )}
          {linesOver.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-center">
              <div className="text-[var(--fs-lg)] font-bold font-mono text-blue-700">{linesOver.length}</div>
              <div className="text-[9px] font-semibold text-blue-500 uppercase tracking-wide">Over</div>
            </div>
          )}
        </div>
      )}

      {/* Cost comparison */}
      {orderedTotal > 0 && (
        <div className="bg-gray-50 rounded-xl px-3.5 py-2.5 mb-3 border border-gray-100">
          <div className="flex justify-between text-[var(--fs-xs)] text-gray-500">
            <span>Ordered value</span>
            <span className="font-mono">&euro;{orderedTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[var(--fs-xs)] text-gray-500">
            <span>Received value</span>
            <span className="font-mono">&euro;{receivedTotal.toFixed(2)}</span>
          </div>
          {orderedTotal !== receivedTotal && (
            <div className={`flex justify-between text-[var(--fs-xs)] font-bold pt-1 border-t border-gray-200 mt-1 ${receivedTotal < orderedTotal ? 'text-red-600' : 'text-blue-600'}`}>
              <span>Difference</span>
              <span className="font-mono">{receivedTotal > orderedTotal ? '+' : ''}&euro;{(receivedTotal - orderedTotal).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Line items with checkmarks */}
      <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-2">Items ({totalLines})</div>
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {receiptLines.map(line => {
          const checked = checkedLines[line.id] || false;
          const qty = line.received_qty;
          const isShort = qty !== null && qty < line.ordered_qty;
          const isOver = qty !== null && qty > line.ordered_qty;
          const notDelivered = qty === null || qty === 0;

          return (
            <div key={line.id} className="py-3 border-b border-gray-100 last:border-0">
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => onToggleCheck(line.id)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                    checked
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 border border-gray-300 text-transparent'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{line.product_name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[var(--fs-xs)] text-gray-500 font-mono">
                      {qty !== null ? qty : '\u2014'} / {line.ordered_qty} {line.product_uom}
                    </span>
                    {isShort && !line.has_issue && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-700">
                        {line.difference > 0 ? '+' : ''}{line.difference}
                      </span>
                    )}
                    {isOver && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-blue-100 text-blue-700">
                        +{line.difference}
                      </span>
                    )}
                    {notDelivered && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-gray-100 text-gray-500">
                        Not received
                      </span>
                    )}
                  </div>
                  {line.has_issue === 1 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-red-100 text-red-700">
                        {line.issue_type || 'Issue'}
                      </span>
                      {line.issue_notes && (
                        <span className="text-[10px] text-red-500 truncate">{line.issue_notes}</span>
                      )}
                    </div>
                  )}
                </div>
                {line.price && line.price > 0 && qty !== null && qty > 0 && (
                  <div className="text-[var(--fs-xs)] font-bold font-mono text-gray-900 flex-shrink-0">
                    &euro;{(qty * line.price).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Delivery note photo */}
      <div className="mt-4">
        <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-2">
          Delivery note photo
          {deliveryNotePhoto ? <span className="text-green-600 ml-2">Attached</span> : <span className="ml-1 font-normal normal-case">(recommended)</span>}
        </div>
        {deliveryNotePhoto ? (
          <div className="relative">
            <img src={deliveryNotePhoto} alt="Delivery note" className="w-full h-40 object-cover rounded-xl border border-gray-200" />
            <button
              onClick={() => setDeliveryNotePhoto('')}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white text-[var(--fs-sm)]"
            >
              &times;
            </button>
            <div className="mt-2 text-center">
              <label className="text-[var(--fs-xs)] font-semibold text-green-700 cursor-pointer active:opacity-70">
                Retake photo
                
              </label>
            </div>
            <div className="flex items-center gap-2 mt-2 px-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              <span className="text-[var(--fs-xs)] text-green-700">Photo will be uploaded to Odoo as a log note on this order</span>
            </div>
          </div>
        ) : (
          <label className="block cursor-pointer">
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-5 text-center active:bg-gray-50">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" className="mx-auto mb-1.5">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <div className="text-[var(--fs-xs)] font-semibold text-gray-900">Take photo of delivery note</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Saved to Odoo as proof of delivery</div>
            </div>
            
          </label>
        )}
      </div>

      {/* Fixed bottom: manager confirmation */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {!allChecked ? (
          <div className="text-center">
            <div className="w-full py-3 rounded-xl bg-gray-100 text-gray-400 text-[var(--fs-md)] font-bold cursor-not-allowed">
              Check all items to continue
            </div>
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">{totalLines - checkedCount} item{totalLines - checkedCount !== 1 ? 's' : ''} remaining</p>
          </div>
        ) : isManager ? (
          <>
            <label className="flex items-start gap-2.5 mb-3 cursor-pointer active:opacity-80">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                  managerConfirmed ? 'bg-green-500 text-white' : 'bg-white border-2 border-gray-300'
                }`}
                onClick={() => setManagerConfirmed(!managerConfirmed)}
              >
                {managerConfirmed && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
              <span className="text-[var(--fs-xs)] text-gray-900 leading-relaxed">
                I confirm all quantities are correct and have been physically verified.
              </span>
            </label>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  onSetConfirmDialog({
                    title: 'Confirm receipt?',
                    message: `This will update stock quantities in Odoo and close this order. ${linesNotReceived.length > 0 ? `${linesNotReceived.length} item(s) were not received and will be marked as not delivered.` : ''} This cannot be undone.`,
                    confirmLabel: 'Yes, confirm & close',
                    variant: 'primary',
                    onConfirm: () => {
                      onSetConfirmDialog(null);
                      onConfirm(true, deliveryNotePhoto || undefined);
                    },
                  })
                }
                disabled={!canConfirm}
                className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Confirm &amp; close
              </button>
              <button
                onClick={() =>
                  onSetConfirmDialog({
                    title: 'Keep as backorder?',
                    message: 'Received quantities will be updated in Odoo. The remaining items will stay open for a future delivery.',
                    confirmLabel: 'Yes, keep backorder',
                    variant: 'primary',
                    onConfirm: () => {
                      onSetConfirmDialog(null);
                      onConfirm(false, deliveryNotePhoto || undefined);
                    },
                  })
                }
                disabled={!canConfirm}
                className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[var(--fs-sm)] font-semibold active:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Keep as backorder
              </button>
            </div>
            <p className="text-[var(--fs-xs)] text-gray-400 text-center mt-1.5">
              {deliveryNotePhoto ? 'Photo + receipt will be logged in Odoo.' : 'Confirming will update stock in Odoo.'}
            </p>
          </>
        ) : (
          <p className="text-[var(--fs-xs)] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>
        )}
      </div>
    </div>
  );
}
