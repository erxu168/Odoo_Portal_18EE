'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { TERMINATION_TYPE_LABELS, STATE_LABELS, DELIVERY_METHOD_LABELS } from '@/types/termination';
import type { TerminationRecord, TerminationType, TerminationState, DeliveryMethod } from '@/types/termination';

interface Props {
  id: number;
  onBack: () => void;
  onHome: () => void;
  onDeliver: (id: number) => void;
  onRefresh: () => void;
}

const STATE_COLORS: Record<TerminationState, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  signed: 'bg-yellow-100 text-yellow-800',
  delivered: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
};

export default function TerminationDetail({ id, onBack, onHome, onDeliver }: Props) {
  const [rec, setRec] = useState<TerminationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  async function load() {
    try {
      const res = await fetch(`/api/termination/${id}`);
      const data = await res.json();
      if (data.ok) setRec(data.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  async function handleGeneratePdf() {
    setActionLoading('pdf');
    try {
      const res = await fetch(`/api/termination/${id}/pdf`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await load();
      } else {
        alert(data.error || 'PDF-Erstellung fehlgeschlagen');
      }
    } catch { alert('Fehler'); }
    finally { setActionLoading(''); }
  }

  async function handleDownloadPdf() {
    if (!rec?.pdf_attachment_id) return;
    const attId = Array.isArray(rec.pdf_attachment_id) ? rec.pdf_attachment_id[0] : rec.pdf_attachment_id;
    window.open(`/api/termination/${id}/pdf?download=1`, '_blank');
  }

  if (loading) {
    return (
      <>
        <AppHeader title="K\u00fcndigung" showBack onBack={onBack} />
        <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" /></div>
      </>
    );
  }

  if (!rec) {
    return (
      <>
        <AppHeader title="K\u00fcndigung" showBack onBack={onBack} />
        <div className="text-center py-16 text-gray-400">Nicht gefunden</div>
      </>
    );
  }

  const state = rec.state as TerminationState;

  return (
    <>
      <AppHeader
        title={rec.employee_name}
        subtitle={TERMINATION_TYPE_LABELS[rec.termination_type as TerminationType]}
        showBack
        onBack={onBack}
      />
      <div className="px-4 py-4 space-y-4 pb-24">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATE_COLORS[state]}`}>
            {STATE_LABELS[state]}
          </span>
          <span className="text-xs text-gray-400">KW-{rec.id}</span>
        </div>

        {/* Key dates */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Fristen</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Datum des Schreibens</span><span className="font-medium">{rec.letter_date}</span></div>
            {rec.notice_period_text && <div className="flex justify-between"><span className="text-gray-500">K\u00fcndigungsfrist</span><span className="font-medium">{rec.notice_period_text}</span></div>}
            <div className="flex justify-between"><span className="text-gray-500">Letzter Arbeitstag</span><span className="font-bold text-red-600">{rec.last_working_day || '\u2013'}</span></div>
            {rec.tenure_years > 0 && <div className="flex justify-between"><span className="text-gray-500">Betriebszugeh\u00f6rigkeit</span><span>{rec.tenure_years} Jahre</span></div>}
          </div>
        </div>

        {/* Address */}
        {rec.employee_street && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Adresse</div>
            <div className="text-sm text-gray-700">
              {rec.employee_street}<br/>
              {rec.employee_zip} {rec.employee_city}
            </div>
          </div>
        )}

        {/* Delivery info */}
        {rec.delivery_method && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Zustellung</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Art</span><span>{DELIVERY_METHOD_LABELS[rec.delivery_method as DeliveryMethod]}</span></div>
              {rec.delivery_date && <div className="flex justify-between"><span className="text-gray-500">Datum</span><span>{rec.delivery_date}</span></div>}
              {rec.delivery_tracking_number && <div className="flex justify-between"><span className="text-gray-500">Sendungsnr.</span><span className="font-mono">{rec.delivery_tracking_number}</span></div>}
              {rec.delivery_witness && <div className="flex justify-between"><span className="text-gray-500">Zeuge</span><span>{rec.delivery_witness}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Best\u00e4tigt</span><span className={rec.delivery_confirmed ? 'text-green-600 font-bold' : 'text-orange-600'}>{rec.delivery_confirmed ? 'Ja' : 'Ausstehend'}</span></div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          {state === 'confirmed' && !rec.pdf_attachment_id && (
            <button
              onClick={handleGeneratePdf}
              disabled={actionLoading === 'pdf'}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm active:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading === 'pdf' ? 'Wird erstellt...' : 'PDF erstellen'}
            </button>
          )}

          {rec.pdf_attachment_id && (
            <button
              onClick={handleDownloadPdf}
              className="w-full py-3 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-sm active:bg-gray-50"
            >
              PDF herunterladen
            </button>
          )}

          {state === 'signed' && (
            <button
              onClick={() => onDeliver(id)}
              className="w-full py-3 rounded-xl bg-green-600 text-white font-bold text-sm active:bg-green-700"
            >
              Zustellung erfassen
            </button>
          )}
        </div>
      </div>
    </>
  );
}
