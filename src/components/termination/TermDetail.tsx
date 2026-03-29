'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { TerminationRecord, DeliveryMethod } from '@/types/termination';
import { TERMINATION_TYPE_LABELS, STATE_LABELS, DELIVERY_METHOD_LABELS } from '@/types/termination';
import DeliveryForm from './DeliveryForm';
import PdfViewer from '@/components/ui/PdfViewer';

interface Props {
  id: number;
  onBack: () => void;
  onHome: () => void;
}

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  signed: 'bg-green-100 text-green-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
};

const STEPS = ['draft', 'confirmed', 'signed', 'delivered', 'archived'];

export default function TermDetail({ id, onBack, onHome }: Props) {
  const [rec, setRec] = useState<TerminationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [accountantLoading, setAccountantLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  const fetchRecord = useCallback(async () => {
    try {
      const res = await fetch(`/api/termination/${id}`);
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else setError(json.error);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  async function handleConfirm() {
    if (!confirm('Confirm this termination? Employee departure date will be set.')) return;
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/confirm`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else alert(json.error);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleGeneratePdf() {
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/pdf`, { method: 'POST' });
      if (res.ok) {
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setPdfBase64(base64);
          setShowPdf(true);
        };
        reader.readAsDataURL(blob);
        await fetchRecord();
      } else {
        const json = await res.json();
        alert(json.error || 'PDF generation failed');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleViewPdf() {
    try {
      const res = await fetch(`/api/termination/${id}/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setPdfBase64(base64);
          setShowPdf(true);
        };
        reader.readAsDataURL(blob);
      } else {
        alert('No PDF available');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  }

  async function handlePrintPdf() {
    try {
      const res = await fetch(`/api/termination/${id}/pdf`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const printWindow = window.open(url, '_blank');
        if (printWindow) {
          printWindow.addEventListener('load', () => {
            setTimeout(() => printWindow.print(), 500);
          });
        }
      } else {
        alert('No PDF available');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleMarkSigned() {
    if (!confirm('Mark as signed?')) return;
    try {
      const res = await fetch(`/api/termination/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'signed' }),
      });
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else alert(json.error);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleDeliverySubmit(data: {
    delivery_method: DeliveryMethod;
    delivery_date: string;
    delivery_tracking_number?: string;
    delivery_witness?: string;
    delivery_notes?: string;
  }) {
    try {
      const res = await fetch(`/api/termination/${id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.ok) {
        setRec(json.data);
        setShowDelivery(false);
      } else {
        alert(json.error);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleSendToAccountant() {
    if (!confirm('Send to accountant?')) return;
    setAccountantLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sent_to_accountant: true, sent_to_accountant_date: new Date().toISOString().replace('T', ' ').slice(0, 19) }),
      });
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else alert(json.error);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setAccountantLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this termination? This will reset the employee\u2019s departure date.')) return;
    if (!confirm('Are you sure? This action cannot be undone.')) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/cancel`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else alert(json.error);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setCancelLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full" /></div>;
  if (error || !rec) return <div className="px-5 pt-12"><p className="text-red-600">{error || 'Not found'}</p></div>;

  const stepIdx = STEPS.indexOf(rec.state);
  const canCancel = ['draft', 'confirmed', 'signed'].includes(rec.state);
  const fmt = (d: string | false) => {
    if (!d) return '\u2013';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[18px] font-bold text-white truncate">{rec.employee_name}</h1>
            <p className="text-[12px] text-white/50">{TERMINATION_TYPE_LABELS[rec.termination_type]}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 pb-8 -mt-3">
        {/* Cancelled banner */}
        {rec.state === 'cancelled' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-3 text-center">
            <span className="text-red-700 font-semibold text-[14px]">This termination has been cancelled</span>
          </div>
        )}

        {/* Progress bar */}
        {rec.state !== 'cancelled' && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <div className="flex items-center gap-1">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <div className={`flex-1 h-1.5 rounded-full ${i <= stepIdx ? 'bg-red-500' : 'bg-gray-200'}`} />
                  {i < STEPS.length - 1 && <div className="w-0.5" />}
                </React.Fragment>
              ))}
            </div>
            <div className="flex justify-between mt-2">
              {STEPS.map((s, i) => (
                <span key={s} className={`text-[9px] ${i <= stepIdx ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                  {STATE_LABELS[s as keyof typeof STATE_LABELS]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Info card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-gray-900">Details</span>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${STATE_COLORS[rec.state] || ''}`}>
              {STATE_LABELS[rec.state]}
            </span>
          </div>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-gray-500">Company</span><span className="text-gray-900 font-medium">{rec.company_id[1]}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Letter date</span><span className="text-gray-900">{fmt(rec.letter_date)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Notice period</span><span className="text-gray-900">{rec.notice_period_text}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Last working day</span><span className="text-gray-900 font-bold">{fmt(rec.last_working_day)}</span></div>
            {rec.tenure_years > 0 && <div className="flex justify-between"><span className="text-gray-500">Tenure</span><span className="text-gray-900">{rec.tenure_years} years</span></div>}
            {rec.include_severance && <div className="flex justify-between"><span className="text-gray-500">Severance</span><span className="text-gray-900 font-bold">{rec.severance_amount.toFixed(2)} EUR</span></div>}
          </div>
        </div>

        {/* Delivery card */}
        {rec.state === 'delivered' && rec.delivery_method && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <span className="text-[13px] font-semibold text-gray-900 block mb-3">Delivery</span>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-gray-500">Method</span><span className="text-gray-900">{DELIVERY_METHOD_LABELS[rec.delivery_method]}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="text-gray-900">{fmt(rec.delivery_date)}</span></div>
              {rec.delivery_tracking_number && <div className="flex justify-between"><span className="text-gray-500">Tracking #</span><span className="text-gray-900">{rec.delivery_tracking_number}</span></div>}
              {rec.delivery_witness && <div className="flex justify-between"><span className="text-gray-500">Witness</span><span className="text-gray-900">{rec.delivery_witness}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Confirmed</span><span className={rec.delivery_confirmed ? 'text-green-600 font-medium' : 'text-yellow-600'}>{rec.delivery_confirmed ? 'Yes' : 'Pending'}</span></div>
            </div>
          </div>
        )}

        {/* Delivery form */}
        {showDelivery && rec.state === 'signed' && (
          <DeliveryForm
            onSubmit={handleDeliverySubmit}
            onCancel={() => setShowDelivery(false)}
          />
        )}

        {/* Actions */}
        <div className="space-y-2.5 mt-4">
          {rec.state === 'draft' && (
            <button onClick={handleConfirm} disabled={confirmLoading}
              className="w-full py-3.5 rounded-2xl bg-blue-600 text-white font-semibold text-[14px] active:bg-blue-700 disabled:opacity-50">
              {confirmLoading ? 'Confirming...' : 'Confirm termination'}
            </button>
          )}

          {rec.state === 'confirmed' && !rec.pdf_attachment_id && (
            <button onClick={handleGeneratePdf} disabled={pdfLoading}
              className="w-full py-3.5 rounded-2xl bg-red-600 text-white font-semibold text-[14px] active:bg-red-700 disabled:opacity-50">
              {pdfLoading ? 'Generating PDF...' : 'Generate PDF'}
            </button>
          )}

          {rec.pdf_attachment_id && (
            <div className="flex gap-2">
              <button onClick={handleViewPdf}
                className="flex-1 py-3.5 rounded-2xl bg-white border border-gray-200 text-gray-900 font-semibold text-[14px] flex items-center justify-center gap-2 active:bg-gray-50">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                View
              </button>
              <button onClick={handlePrintPdf}
                className="flex-1 py-3.5 rounded-2xl bg-white border border-gray-200 text-gray-900 font-semibold text-[14px] flex items-center justify-center gap-2 active:bg-gray-50">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>
            </div>
          )}

          {rec.state === 'confirmed' && rec.pdf_attachment_id && (
            <button onClick={handleMarkSigned}
              className="w-full py-3.5 rounded-2xl bg-green-600 text-white font-semibold text-[14px] active:bg-green-700">
              Mark as signed
            </button>
          )}

          {rec.state === 'signed' && !showDelivery && (
            <button onClick={() => setShowDelivery(true)}
              className="w-full py-3.5 rounded-2xl bg-red-600 text-white font-semibold text-[14px] active:bg-red-700">
              Record delivery
            </button>
          )}

          {['signed', 'delivered'].includes(rec.state) && !rec.sent_to_accountant && (
            <button onClick={handleSendToAccountant} disabled={accountantLoading}
              className="w-full py-3.5 rounded-2xl bg-white border border-gray-200 text-gray-700 font-semibold text-[14px] active:bg-gray-50 disabled:opacity-50">
              {accountantLoading ? 'Sending...' : 'Send to accountant'}
            </button>
          )}

          {rec.sent_to_accountant && (
            <div className="text-center text-[12px] text-green-600 font-medium py-2">
              {'\u2713'} Sent to accountant
            </div>
          )}

          {/* Cancel button — separated with space, requires double confirmation */}
          {canCancel && (
            <div className="pt-4 mt-4 border-t border-gray-200">
              <button onClick={handleCancel} disabled={cancelLoading}
                className="w-full py-3 rounded-2xl bg-white border border-red-200 text-red-600 font-medium text-[13px] active:bg-red-50 disabled:opacity-50">
                {cancelLoading ? 'Cancelling...' : 'Cancel termination'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PDF Viewer modal */}
      {showPdf && pdfBase64 && (
        <PdfViewer
          fileData={pdfBase64}
          fileName={`Termination_${rec.employee_name.replace(/\s+/g, '_')}.pdf`}
          onClose={() => setShowPdf(false)}
        />
      )}
    </div>
  );
}
