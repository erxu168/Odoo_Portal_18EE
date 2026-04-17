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

// Mirror of the ScanResult returned by /api/purchase/receive/scan.
interface ScanMatched {
  line_id: number;
  product_name: string;
  received_qty: number;
  ocr_price: number | null;
  confidence: 'high' | 'medium' | 'low';
  price_flag: boolean;
}
interface ScanResult {
  ocr_mode: 'mock' | 'azure';
  matched: ScanMatched[];
  unmatched_ocr: { description: string; quantity: number | null; unit_price: number | null }[];
  missing_ordered: { line_id: number; product_name: string; ordered_qty: number }[];
}

interface ReceiveCheckScreenProps {
  order: RecvOrder | null;
  lines: ReceiptLine[];
  isManager: boolean;

  // OCR scan state
  scanning: boolean;
  scanResult: ScanResult | null;
  scanErr: string;
  onScanFile: (file: File) => void;
  onDismissScan: () => void;

  // Per-line actions
  onUpdateQty: (lineId: number, qty: number) => void;
  onOpenNumpad: (line: ReceiptLine) => void;
  onReportIssue: (line: ReceiptLine) => void;

  // Bottom action bar
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
  scanning,
  scanResult,
  scanErr,
  onScanFile,
  onDismissScan,
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

      {isManager && (
        <div className="mb-3">
          <FilePicker
            onFile={(file) => onScanFile(file)}
            accept="image/*"
            variant="button"
            icon="\u{1F4F7}"
            loading={scanning}
            disabled={scanning}
            label={scanning ? 'Scanning delivery note...' : 'Scan delivery note'}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold shadow-sm transition-colors ${scanning ? 'bg-gray-200 text-gray-500' : 'bg-[#2563EB] text-white active:bg-blue-700'}`}
          />
          {scanErr && <div className="mt-2 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{scanErr}</div>}
          {scanResult && !scanning && (
            <div className="mt-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
              <div className="flex items-center gap-2">
                <span className="text-[14px]">&#128196;</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-blue-900">
                    Scan complete
                    {scanResult.ocr_mode === 'mock' && (
                      <span className="ml-1 text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">MOCK</span>
                    )}
                  </div>
                  <div className="text-[11px] text-blue-800">
                    {scanResult.matched.length} matched
                    {scanResult.unmatched_ocr.length > 0 && ` \u2022 ${scanResult.unmatched_ocr.length} unmatched`}
                    {scanResult.missing_ordered.length > 0 && ` \u2022 ${scanResult.missing_ordered.length} not on note`}
                  </div>
                </div>
                <button onClick={onDismissScan} className="text-blue-400 text-[16px] flex-shrink-0" aria-label="Dismiss">&times;</button>
              </div>
              {scanResult.unmatched_ocr.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] font-semibold text-blue-700 cursor-pointer">Lines on the note that didn&rsquo;t match</summary>
                  <ul className="mt-1.5 text-[11px] text-gray-700 space-y-1">
                    {scanResult.unmatched_ocr.map((u, i) => (
                      <li key={i} className="font-mono">
                        &bull; {u.description || '(no description)'} {u.quantity != null && `\u00d7 ${u.quantity}`}{' '}
                        {u.unit_price != null && `@ \u20ac${u.unit_price.toFixed(2)}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {scanResult.missing_ordered.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] font-semibold text-amber-700 cursor-pointer">Ordered items not on the note</summary>
                  <ul className="mt-1.5 text-[11px] text-gray-700 space-y-1">
                    {scanResult.missing_ordered.map((m) => (
                      <li key={m.line_id}>&bull; {m.product_name} (ordered {m.ordered_qty})</li>
                    ))}
                  </ul>
                </details>
              )}
              {scanResult.matched.some((m) => m.price_flag) && (
                <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                  <strong>Price mismatch:</strong>{' '}
                  {scanResult.matched.filter((m) => m.price_flag).map((m) => m.product_name).join(', ')}. Please verify.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[12px] text-gray-500 mb-3">Enter the quantity you actually received. Leave blank if not delivered yet.</p>

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
                    {linePrice > 0 && ` \u00b7 \u20ac${linePrice.toFixed(2)}/${line.product_uom}`}
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
        {isManager ? (
          <>
            <div className="flex gap-2 mb-2">
              <button onClick={onConfirmClose} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Confirm &amp; close</button>
              <button onClick={onKeepBackorder} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep as backorder</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">Confirming will update stock in Odoo.</p>
          </>
        ) : (
          <p className="text-[12px] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>
        )}
      </div>
    </div>
  );
}
