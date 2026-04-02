'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { TerminationRecord, DeliveryMethod } from '@/types/termination';
import { TERMINATION_TYPE_LABELS, STATE_LABELS, DELIVERY_METHOD_LABELS } from '@/types/termination';
import DeliveryForm from './DeliveryForm';
import PdfViewer from '@/components/ui/PdfViewer';
import PdfDocumentCard from '@/components/ui/PdfDocumentCard';

function getTrackingUrl(trackingNumber: string): string {
  const clean = trackingNumber.replace(/\s+/g, "");
  const dhl = (code: string) =>
    `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(code)}`;
  if (/^1Z/i.test(clean)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(clean)}`;
  if (/^H\d{19}$/i.test(clean)) return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation?trackingId=${encodeURIComponent(clean)}`;
  if (/^\d{14}$/.test(clean)) return `https://tracking.dpd.de/status/de_DE/parcel/${encodeURIComponent(clean)}`;
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
  const [stageLoading, setStageLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // For the initial PDF generation flow (opens viewer after generating)
  const [showGenPdf, setShowGenPdf] = useState(false);
  const [genPdfBase64, setGenPdfBase64] = useState<string | null>(null);

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

  // --- Helpers for PdfDocumentCard ---

  async function fetchPdfBase64(): Promise<{ base64: string; name: string }> {
    const res = await fetch(`/api/termination/${id}/pdf`);
    if (!res.ok) throw new Error('No PDF available');
    const blob = await res.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const name = rec?.signed_pdf_attachment_id
      ? rec.signed_pdf_attachment_id[1]
      : rec?.pdf_attachment_id
        ? rec.pdf_attachment_id[1]
        : 'Termination.pdf';
    return { base64, name };
  }

  async function printPdf() {
    const res = await fetch(`/api/termination/${id}/pdf`);
    if (!res.ok) throw new Error('No PDF available');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => setTimeout(() => w.print(), 500));
  }

  async function uploadSignedDoc(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const res = await fetch(`/api/termination/${id}/upload-signed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: dataUrl,
        filename: `Kuendigung_unterschrieben_${rec?.employee_name?.replace(/\s+/g, '_') || id}.pdf`,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Upload failed');
    await fetchRecord();
  }

  async function fetchProofBase64(): Promise<{ base64: string; name: string }> {
    const res = await fetch(`/api/termination/${id}/upload-proof`);
    const data = await res.json();
    if (!data.data_base64) throw new Error('No proof document');
    return { base64: data.data_base64, name: data.name || 'Courier_confirmation.pdf' };
  }

  async function printProof() {
    const { base64, name } = await fetchProofBase64();
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const blob = new Blob([arr], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => setTimeout(() => w.print(), 500));
    void name; // suppress unused
  }

  async function uploadProofDoc(file: File) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const res = await fetch(`/api/termination/${id}/upload-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_base64: base64, filename: file.name, mimetype: file.type }),
    });
    if (!res.ok) throw new Error('Upload failed');
    await fetchRecord();
  }

  // --- State actions ---

  async function handleSetState(newState: string) {
    if (!rec || newState === rec.state) return;
    const label = STATE_LABELS[newState as keyof typeof STATE_LABELS] || newState;
    if (!confirm(`Change stage to "${label}"?`)) return;
    setStageLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState }),
      });
      const json = await res.json();
      if (json.ok) setRec(json.data); else alert(json.error);
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
    finally { setStageLoading(false); }
  }

  async function handleConfirm() {
    if (!confirm('Confirm this termination? Employee departure date will be set.')) return;
    setConfirmLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/confirm`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) setRec(json.data); else alert(json.error);
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
    finally { setConfirmLoading(false); }
  }

  async function handleGeneratePdf() {
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/pdf`, { method: 'POST' });
      if (res.ok) {
        const blob = await res.blob();
        const r = new FileReader();
        r.onload = () => { setGenPdfBase64((r.result as string).split(',')[1]); setShowGenPdf(true); };
        r.readAsDataURL(blob);
        await fetchRecord();
      } else {
        const json = await res.json();
        alert(json.error || 'PDF generation failed');
      }
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
    finally { setPdfLoading(false); }
  }

  async function handleDeliverySubmit(data: {
    delivery_method: DeliveryMethod; delivery_date: string;
    delivery_tracking_number?: string; delivery_witness?: string; delivery_notes?: string;
  }) {
    try {
      const res = await fetch(`/api/termination/${id}/deliver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.ok) { setRec(json.data); setShowDelivery(false); } else alert(json.error);
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
  }

  async function handleSendToAccountant() {
    if (!confirm('Send termination letter to accountant via email?')) return;
    setAccountantLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/send-accountant`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) setRec(json.data); else alert(json.error);
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
    finally { setAccountantLoading(false); }
  }

  async function handleCancel() {
    if (!confirm('Cancel this termination? This will reset the employee\u2019s departure date.')) return;
    if (!confirm('Are you sure? This action cannot be undone.')) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/cancel`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) setRec(json.data); else alert(json.error);
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
    finally { setCancelLoading(false); }
  }

  async function handleDelete() {
    if (!confirm('Delete this draft termination? This cannot be undone.')) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/termination/${id}/delete`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) onBack(); else alert(json.error || 'Delete failed');
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Delete failed'); }
    finally { setDeleteLoading(false); }
  }

  async function handleTrackingSave() {
    if (!rec) return;
    setSavingTracking(true);
    try {
      const res = await fetch(`/api/termination/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_tracking_number: trackingDraft || false }),
      });
      if (res.ok) { const data = await res.json(); if (data.data) setRec(data.data); }
    } catch (_e) { console.error('Failed to save tracking number'); }
    finally { setSavingTracking(false); setEditingTracking(false); }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full" /></div>;
  if (error || !rec) return <div className="px-5 pt-12"><p className="text-red-600">{error || 'Not found'}</p></div>;

  const stepIdx = STEPS.indexOf(rec.state);
  const canCancel = ['draft', 'confirmed', 'signed'].includes(rec.state);
  const hasPdf = !!rec.pdf_attachment_id;
  const hasSigned = !!rec.signed_pdf_attachment_id;
  const fmt = (d: string | false) => {
    if (!d) return '\u2013';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

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
            {stageLoading && <div className="flex justify-center mb-2"><div className="w-4 h-4 border-2 border-gray-300 border-t-green-500 rounded-full animate-spin" /></div>}
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
                const isCurrent = s === rec.state;
                return (
                  <button key={s} onClick={() => handleSetState(s)} disabled={stageLoading || s === 'draft'}
                    className={`text-[9px] px-1 py-0.5 rounded transition-colors ${isCurrent ? 'text-green-700 font-bold bg-green-50' : i <= stepIdx ? 'text-green-600 font-medium active:bg-green-50' : 'text-gray-400 active:bg-gray-100'} ${s === 'draft' ? 'opacity-50 cursor-not-allowed' : ''}`}>
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
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${STATE_COLORS[rec.state] || ''}`}>{STATE_LABELS[rec.state]}</span>
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

        {/* === TERMINATION LETTER / SIGNED DOC — PdfDocumentCard === */}
        {hasPdf && !['draft', 'cancelled'].includes(rec.state) && (
          <div className="mb-3">
            <PdfDocumentCard
              label={hasSigned ? 'Signed document' : 'Termination letter'}
              hasDocument={true}
              documentName={hasSigned ? rec.signed_pdf_attachment_id![1] : rec.pdf_attachment_id![1]}
              onView={fetchPdfBase64}
              onPrint={printPdf}
              onUpload={uploadSignedDoc}
              accent={hasSigned ? 'green' : 'blue'}
            />
          </div>
        )}

        {/* Upload signed doc slot (when PDF exists but no signed version yet) */}
        {hasPdf && !hasSigned && !['draft', 'cancelled'].includes(rec.state) && (
          <div className="mb-3">
            <PdfDocumentCard
              label="Signed document"
              hasDocument={false}
              onView={async () => ({ base64: '', name: '' })}
              onPrint={async () => {}}
              onUpload={uploadSignedDoc}
              accent="green"
              emptyLabel="Upload signed letter"
            />
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
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Tracking #</span>
                  {editingTracking ? (
                    <div className="flex items-center gap-2">
                      <input type="text" value={trackingDraft} onChange={e => setTrackingDraft(e.target.value)}
                        placeholder="RR 1234 5678 9 DE" autoFocus
                        className="w-40 px-2.5 py-1.5 border border-gray-200 rounded-lg text-[var(--fs-sm)] text-gray-900 outline-none focus:border-green-600" />
                      <button onClick={handleTrackingSave} disabled={savingTracking}
                        className="px-3 py-1.5 bg-green-600 text-white text-[var(--fs-xs)] font-bold rounded-lg active:bg-green-700 disabled:opacity-50">
                        {savingTracking ? '...' : 'Save'}</button>
                      <button onClick={() => setEditingTracking(false)}
                        className="px-2 py-1.5 text-gray-400 text-[var(--fs-xs)] font-semibold active:text-gray-600">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <a href={getTrackingUrl(String(rec.delivery_tracking_number))} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 font-medium underline underline-offset-2 active:text-blue-800">
                        {rec.delivery_tracking_number}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline ml-1 -mt-0.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                      <button onClick={() => { setTrackingDraft(rec.delivery_tracking_number || ''); setEditingTracking(true); }}
                        className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {rec.delivery_witness && <div className="flex justify-between"><span className="text-gray-500">Witness</span><span className="text-gray-900">{rec.delivery_witness}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Confirmed</span><span className={rec.delivery_confirmed ? 'text-green-600 font-medium' : 'text-yellow-600'}>{rec.delivery_confirmed ? 'Yes' : 'Pending'}</span></div>
            </div>

            {/* === COURIER CONFIRMATION — PdfDocumentCard === */}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <PdfDocumentCard
                label="Courier confirmation"
                hasDocument={!!rec.delivery_proof_attachment_id}
                documentName={Array.isArray(rec.delivery_proof_attachment_id) ? rec.delivery_proof_attachment_id[1] : undefined}
                onView={fetchProofBase64}
                onPrint={printProof}
                onUpload={uploadProofDoc}
                accent="gray"
                emptyLabel="Upload courier confirmation"
              />
            </div>
          </div>
        )}

        {/* Delivery form */}
        {showDelivery && (
          <DeliveryForm onSubmit={handleDeliverySubmit} onCancel={() => setShowDelivery(false)} />
        )}

        {/* Actions */}
        <div className="space-y-2.5 mt-4">
          {rec.state === 'draft' && (
            <button onClick={handleConfirm} disabled={confirmLoading}
              className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold text-[14px] active:bg-blue-700 disabled:opacity-50">
              {confirmLoading ? 'Confirming...' : 'Confirm termination'}</button>
          )}

          {rec.state === 'confirmed' && !rec.pdf_attachment_id && (
            <button onClick={handleGeneratePdf} disabled={pdfLoading}
              className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold text-[14px] active:bg-red-700 disabled:opacity-50">
              {pdfLoading ? 'Generating PDF...' : 'Generate PDF'}</button>
          )}

          {rec.state === 'confirmed' && rec.pdf_attachment_id && (
            <button onClick={() => handleSetState('signed')}
              className="w-full py-3.5 rounded-xl bg-green-600 text-white font-semibold text-[14px] active:bg-green-700">
              Mark as signed</button>
          )}

          {['signed', 'delivered'].includes(rec.state) && !showDelivery && !rec.delivery_method && (
            <button onClick={() => setShowDelivery(true)}
              className="w-full py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-[14px] active:bg-gray-50">
              Record delivery info</button>
          )}

          {rec.state === 'signed' && (
            <button onClick={() => handleSetState('delivered')}
              className="w-full py-3.5 rounded-xl bg-emerald-600 text-white font-semibold text-[14px] active:bg-emerald-700">
              Mark as delivered</button>
          )}

          {['signed', 'delivered'].includes(rec.state) && !rec.sent_to_accountant && (
            <button onClick={handleSendToAccountant} disabled={accountantLoading}
              className="w-full py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-semibold text-[14px] active:bg-gray-50 disabled:opacity-50">
              {accountantLoading ? 'Sending...' : 'Send to accountant'}</button>
          )}

          {rec.sent_to_accountant && (
            <div className="text-center text-[var(--fs-xs)] text-green-600 font-medium py-2">{'\u2713'} Sent to accountant</div>
          )}

          {rec.state === 'draft' && (
            <div className="pt-4 mt-4 border-t border-gray-200 space-y-2">
              <button onClick={handleDelete} disabled={deleteLoading}
                className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-[13px] active:bg-red-700 disabled:opacity-50">
                {deleteLoading ? 'Deleting...' : 'Delete draft'}</button>
            </div>
          )}
          {canCancel && rec.state !== 'draft' && (
            <div className="pt-4 mt-4 border-t border-gray-200">
              <button onClick={handleCancel} disabled={cancelLoading}
                className="w-full py-3 rounded-xl bg-white border border-red-200 text-red-600 font-medium text-[13px] active:bg-red-50 disabled:opacity-50">
                {cancelLoading ? 'Cancelling...' : 'Cancel termination'}</button>
            </div>
          )}
        </div>
      </div>

      {/* PDF Viewer for initial generation */}
      {showGenPdf && genPdfBase64 && (
        <PdfViewer fileData={genPdfBase64} fileName={`Termination_${rec.employee_name.replace(/\s+/g, '_')}.pdf`} onClose={() => setShowGenPdf(false)} />
      )}
    </div>
  );
}
