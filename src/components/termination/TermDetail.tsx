'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { TerminationRecord, DeliveryMethod } from '@/types/termination';
import { TERMINATION_TYPE_LABELS, STATE_LABELS, DELIVERY_METHOD_LABELS } from '@/types/termination';
import DeliveryForm from './DeliveryForm';
import PdfViewer from '@/components/ui/PdfViewer';
import DocumentUploadWidget from '@/components/ui/DocumentUploadWidget';
import FilePicker from '@/components/ui/FilePicker';


/**
 * Build a carrier tracking URL from a tracking number.
 */
function getTrackingUrl(trackingNumber: string): string {
  const clean = trackingNumber.replace(/\s+/g, "");
  const dhl = (code: string) =>
    `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(code)}`;
  if (/^1Z/i.test(clean))
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(clean)}`;
  if (/^H\d{19}$/i.test(clean))
    return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation?trackingId=${encodeURIComponent(clean)}`;
  if (/^\d{14}$/.test(clean))
    return `https://tracking.dpd.de/status/de_DE/parcel/${encodeURIComponent(clean)}`;
  return dhl(clean);
}

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
  const [editingTracking, setEditingTracking] = useState(false);
  const [trackingDraft, setTrackingDraft] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [stageLoading, setStageLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  async function handleSetState(newState: string) {
    if (!rec) return;
    if (newState === rec.state) return;
    const label = STATE_LABELS[newState as keyof typeof STATE_LABELS] || newState;
    if (!confirm(`Change stage to "${label}"?`)) return;
    setStageLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      const json = await res.json();
      if (json.ok) setRec(json.data);
      else alert(json.error);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error');
    } finally {
      setStageLoading(false);
    }
  }

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

  async function handleUploadSigned(_file: File, dataUrl: string) {
    setUploadLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/upload-signed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: dataUrl,
          filename: `Kuendigung_unterschrieben_${rec?.employee_name?.replace(/\s+/g, '_') || id}.pdf`,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        await fetchRecord();
      } else {
        alert(json.error || 'Upload failed');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
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
    if (!confirm('Send termination letter to accountant via email?')) return;
    setAccountantLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/send-accountant`, { method: 'POST' });
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

  async function handleDelete() {
    if (!confirm('Delete this draft termination? This cannot be undone.')) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/delete`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        onBack();
      } else {
        alert(json.error || 'Delete failed');
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleProofUpload(file: File) {
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await fetch(`/api/termination/${id}/upload-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_base64: base64, filename: file.name, mimetype: file.type }),
    });
    if (res.ok) {
      const recRes = await fetch(`/api/termination/${id}`);
      if (recRes.ok) { const data = await recRes.json(); if (data.data) setRec(data.data); }
    }
  }

  async function handleViewProof(): Promise<{ base64: string; mimetype: string; name: string }> {
    const res = await fetch(`/api/termination/${id}/upload-proof`);
    const data = await res.json();
    return { base64: data.data_base64, mimetype: data.mimetype, name: data.name };
  }

  async function handleDeleteProof() {
    await fetch(`/api/termination/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivery_proof_attachment_id: false }),
    });
    const recRes = await fetch(`/api/termination/${id}`);
    if (recRes.ok) { const data = await recRes.json(); if (data.data) setRec(data.data); }
  }

  async function handleTrackingSave() {
    if (!rec) return;
    setSavingTracking(true);
    try {
      const res = await fetch("/api/termination/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_tracking_number: trackingDraft || false }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data) setRec(data.data);
      }
    } catch (_e) {
      console.error("Failed to save tracking number");
    } finally {
      setSavingTracking(false);
      setEditingTracking(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full" /></div>;
  if (error || !rec) return <div className="px-5 pt-12"><p className="text-red-600">{error || 'Not found'}</p></div>;

  const stepIdx = STEPS.indexOf(rec.state);
  const canCancel = ['draft', 'confirmed', 'signed'].includes(rec.state);
  const fmt = (d: string | false) => {
    if (!d) return '\u2013';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  // Determine document name to display
  const docName = rec.signed_pdf_attachment_id
    ? rec.signed_pdf_attachment_id[1]
    : rec.pdf_attachment_id
      ? rec.pdf_attachment_id[1]
      : null;
  const hasSigned = !!rec.signed_pdf_attachment_id;
  const hasPdf = !!rec.pdf_attachment_id;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[var(--fs-xl)] font-bold text-white truncate">{rec.employee_name}</h1>
            <p className="text-[12px] text-white/50">{TERMINATION_TYPE_LABELS[rec.termination_type]}</p>
          </div>
          <button onClick={onHome} className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 pb-8 -mt-3">
        {/* Cancelled banner */}
        {rec.state === 'cancelled' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-3 text-center">
            <span className="text-red-700 font-semibold text-[var(--fs-sm)]">This termination has been cancelled</span>
          </div>
        )}

        {/* Progress bar */}
        {rec.state !== 'cancelled' && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            {stageLoading && (
              <div className="flex justify-center mb-2">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin" />
              </div>
            )}
            <div className="flex items-center gap-1">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <div className={`flex-1 h-1.5 rounded-full ${i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'}`} />
                  {i < STEPS.length - 1 && <div className="w-0.5" />}
                </React.Fragment>
              ))}
            </div>
            <div className="flex justify-between mt-2">
              {STEPS.map((s, i) => {
                const isActive = i <= stepIdx;
                const isCurrent = s === rec.state;
                return (
                  <button
                    key={s}
                    onClick={() => handleSetState(s)}
                    disabled={stageLoading || s === 'draft'}
                    className={`text-[9px] px-1 py-0.5 rounded transition-colors ${
                      isCurrent
                        ? 'text-green-700 font-bold bg-green-50'
                        : isActive
                          ? 'text-green-600 font-medium active:bg-green-50'
                          : 'text-gray-400 active:bg-gray-100'
                    } ${s === 'draft' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {STATE_LABELS[s as keyof typeof STATE_LABELS]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Info card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-900">Details</span>
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

        {/* === UNIFIED DOCUMENT CARD === */}
        {hasPdf && !['draft', 'cancelled'].includes(rec.state) && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            {/* Document header: icon + filename + signed badge */}
            <div className="flex items-center gap-3 mb-3">
              <button onClick={handleViewPdf} className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${hasSigned ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'}`}>
                {hasSigned ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                )}
              </button>
              <div className="flex-1 min-w-0" onClick={handleViewPdf}>
                <div className="text-[13px] font-semibold text-gray-900">{hasSigned ? 'Signed document' : 'Termination letter'}</div>
                <div className={`text-[11px] truncate ${hasSigned ? 'text-green-600' : 'text-gray-500'}`}>{docName}</div>
              </div>
            </div>

            {/* Action buttons: View, Print, Replace */}
            <div className="flex gap-2">
              <button onClick={handleViewPdf}
                className="flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                View
              </button>
              <button onClick={handlePrintPdf}
                className="flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print
              </button>
              <FilePicker
                onFile={handleUploadSigned}
                accept="image/*,.pdf"
                label={hasSigned ? 'Replace' : 'Upload signed'}
                icon=""
                loading={uploadLoading}
                variant="button"
                className="flex-1 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 font-medium text-[12px] flex items-center justify-center gap-1.5 active:bg-gray-100"
              />
            </div>
          </div>
        )}

        {/* Delivery card */}
        {rec.delivery_method && (
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-900 block mb-3">Delivery</span>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-gray-500">Method</span><span className="text-gray-900">{DELIVERY_METHOD_LABELS[rec.delivery_method]}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="text-gray-900">{fmt(rec.delivery_date)}</span></div>
              {(rec.delivery_tracking_number || editingTracking) && (
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Tracking #</span>
                    {editingTracking ? (
                      <div className="flex items-center gap-2">
                        <input type="text" value={trackingDraft} onChange={e => setTrackingDraft(e.target.value)}
                          placeholder="RR 1234 5678 9 DE"
                          className="w-40 px-2.5 py-1.5 border border-gray-200 rounded-lg text-[var(--fs-sm)] text-gray-900 outline-none focus:border-green-600" autoFocus />
                        <button onClick={handleTrackingSave} disabled={savingTracking}
                          className="px-3 py-1.5 bg-green-600 text-white text-[var(--fs-xs)] font-bold rounded-lg active:bg-green-700 disabled:opacity-50">
                          {savingTracking ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingTracking(false)}
                          className="px-2 py-1.5 text-gray-400 text-[var(--fs-xs)] font-semibold active:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <a href={getTrackingUrl(String(rec.delivery_tracking_number))} target="_blank" rel="noopener noreferrer"
                          className="text-blue-600 font-medium underline underline-offset-2 active:text-blue-800">
                          {rec.delivery_tracking_number}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline ml-1 -mt-0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                        <button onClick={() => { setTrackingDraft(rec.delivery_tracking_number || ''); setEditingTracking(true); }}
                          className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200" title="Edit tracking number">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {rec.delivery_witness && <div className="flex justify-between"><span className="text-gray-500">Witness</span><span className="text-gray-900">{rec.delivery_witness}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Confirmed</span><span className={rec.delivery_confirmed ? 'text-green-600 font-medium' : 'text-yellow-600'}>{rec.delivery_confirmed ? 'Yes' : 'Pending'}</span></div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <DocumentUploadWidget
                label="Courier confirmation"
                hasDocument={!!rec.delivery_proof_attachment_id}
                documentName={Array.isArray(rec.delivery_proof_attachment_id) ? rec.delivery_proof_attachment_id[1] : undefined}
                onUpload={handleProofUpload}
                onView={handleViewProof}
                onDelete={handleDeleteProof}
              />
            </div>
          </div>
        )}

        {/* Delivery form */}
        {showDelivery && (
          <DeliveryForm
            onSubmit={handleDeliverySubmit}
            onCancel={() => setShowDelivery(false)}
          />
        )}

        {/* Actions */}
        <div className="space-y-2.5 mt-4">
          {rec.state === 'draft' && (
            <button onClick={handleConfirm} disabled={confirmLoading}
              className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold text-[14px] active:bg-blue-700 disabled:opacity-50">
              {confirmLoading ? 'Confirming...' : 'Confirm termination'}
            </button>
          )}

          {rec.state === 'confirmed' && !rec.pdf_attachment_id && (
            <button onClick={handleGeneratePdf} disabled={pdfLoading}
              className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold text-[14px] active:bg-red-700 disabled:opacity-50">
              {pdfLoading ? 'Generating PDF...' : 'Generate PDF'}
            </button>
          )}

          {rec.state === 'confirmed' && rec.pdf_attachment_id && (
            <button onClick={() => handleSetState('signed')}
              className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-[14px] active:bg-green-700">
              Mark as signed
            </button>
          )}

          {['signed', 'delivered'].includes(rec.state) && !showDelivery && !rec.delivery_method && (
            <button onClick={() => setShowDelivery(true)}
              className="w-full py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-[14px] active:bg-gray-50">
              Record delivery info
            </button>
          )}

          {rec.state === 'signed' && (
            <button onClick={() => handleSetState('delivered')}
              className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-semibold text-[14px] active:bg-emerald-700">
              Mark as delivered
            </button>
          )}

          {['signed', 'delivered'].includes(rec.state) && !rec.sent_to_accountant && (
            <button onClick={handleSendToAccountant} disabled={accountantLoading}
              className="w-full py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-[14px] active:bg-gray-50 disabled:opacity-50">
              {accountantLoading ? 'Sending...' : 'Send to accountant'}
            </button>
          )}

          {rec.sent_to_accountant && (
            <div className="text-center text-[var(--fs-xs)] text-green-600 font-medium py-2">
              {'\u2713'} Sent to accountant
            </div>
          )}

          {rec.state === 'draft' && (
            <div className="pt-4 mt-4 border-t border-gray-200 space-y-2">
              <button onClick={handleDelete} disabled={deleteLoading}
                className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-[13px] active:bg-red-700 disabled:opacity-50">
                {deleteLoading ? 'Deleting...' : 'Delete draft'}
              </button>
            </div>
          )}
          {canCancel && rec.state !== 'draft' && (
            <div className="pt-4 mt-4 border-t border-gray-200">
              <button onClick={handleCancel} disabled={cancelLoading}
                className="w-full py-3 rounded-xl bg-white border border-red-200 text-red-600 font-medium text-[13px] active:bg-red-50 disabled:opacity-50">
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
