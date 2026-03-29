'use client';

import React, { useState, useEffect } from 'react';
import { ds, getBadgeStyle } from '@/lib/design-system';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface TermDetailProps {
  termId: number;
  onBack: () => void;
}

export default function TermDetail({ termId, onBack }: TermDetailProps) {
  const [rec, setRec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [toast, setToast] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/hr/termination/${termId}`)
      .then(r => r.json())
      .then(data => setRec(data.record))
      .catch(() => setRec(null))
      .finally(() => setLoading(false));
  }, [termId]);

  function formatDate(d: string | false): string {
    if (!d) return '---';
    const parts = d.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  async function downloadPdf() {
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/hr/termination/${termId}/pdf`);
      if (!res.ok) throw new Error('PDF failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Kuendigung_KW-${termId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      doToast('PDF heruntergeladen');
    } catch (_e) {
      doToast('Fehler beim PDF-Download');
    } finally {
      setPdfLoading(false);
    }
  }

  async function sendToAccountant() {
    try {
      const res = await fetch(`/api/hr/termination/${termId}/send-accountant`, { method: 'POST' });
      if (!res.ok) throw new Error('Send failed');
      doToast('An Steuerberater gesendet');
      const data = await fetch(`/api/hr/termination/${termId}`).then(r => r.json());
      setRec(data.record);
    } catch (_e) {
      doToast('Fehler beim Senden');
    }
    setShowSendDialog(false);
  }

  async function cancelTermination() {
    try {
      await fetch(`/api/hr/termination/${termId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'cancelled' }),
      });
      doToast('Kuendigung storniert');
      const data = await fetch(`/api/hr/termination/${termId}`).then(r => r.json());
      setRec(data.record);
    } catch (_e) {
      doToast('Fehler');
    }
    setShowCancelDialog(false);
  }

  function doToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  const typeLabels: Record<string, string> = {
    ordentlich: 'Ordentliche Kuendigung', ordentlich_probezeit: 'Ordentliche Kuendigung (Probezeit)',
    fristlos: 'Fristlose Kuendigung', aufhebung: 'Aufhebungsvertrag', bestaetigung: 'Kuendigungsbestaetigung',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Entwurf', confirmed: 'Bestaetigt', signed: 'Unterschrieben',
    archived: 'Archiviert', cancelled: 'Storniert',
  };
  const stateBadgeMap: Record<string, string> = {
    draft: 'draft', confirmed: 'confirmed', signed: 'done',
    archived: 'neutral', cancelled: 'cancel',
  };

  if (loading) {
    return (
      <>
        <AppHeader title="Kuendigung" showBack onBack={onBack} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </>
    );
  }

  if (!rec) {
    return (
      <>
        <AppHeader title="Kuendigung" showBack onBack={onBack} />
        <div className={ds.emptyState}>
          <div className={ds.emptyIcon}>&#x274c;</div>
          <div className={ds.emptyTitle}>Nicht gefunden</div>
        </div>
      </>
    );
  }

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between items-start py-2.5 px-4 border-b border-gray-100 last:border-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className="text-[13px] font-medium text-gray-900 text-right max-w-[55%]">{value}</span>
    </div>
  );

  return (
    <>
      <AppHeader
        supertitle={`KW-${rec.id}`}
        title={rec.employee_name}
        subtitle={rec.company_id?.[1] || ''}
        showBack
        onBack={onBack}
      />

      <div className="px-4 pt-4 pb-24">
        {/* Status badges */}
        <div className="flex items-center gap-2 mb-4">
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold" style={getBadgeStyle(stateBadgeMap[rec.state] || 'neutral')}>
            {stateLabels[rec.state] || rec.state}
          </span>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold" style={getBadgeStyle('neutral')}>
            {typeLabels[rec.termination_type] || rec.termination_type}
          </span>
          {rec.sent_to_accountant && (
            <span className="px-2.5 py-1 rounded-md text-[11px] font-bold" style={getBadgeStyle('done')}>
              Steuerberater
            </span>
          )}
        </div>

        {/* Termination details */}
        <div className={`${ds.sectionLabel} mb-2`}>Kuendigungsdetails</div>
        <div className={`${ds.card} mb-4`}>
          <InfoRow label="Art" value={typeLabels[rec.termination_type] || rec.termination_type} />
          <InfoRow label="Datum des Schreibens" value={formatDate(rec.letter_date)} />
          {rec.notice_period_text && <InfoRow label="Kuendigungsfrist" value={rec.notice_period_text} />}
          <InfoRow label="Letzter Arbeitstag" value={<span className="font-bold">{formatDate(rec.last_working_day)}</span>} />
          <InfoRow label="Berechnungsmethode" value={rec.calc_method === 'bgb' ? 'Paragraph 622 BGB' : 'Ab Zugang'} />
          {rec.garden_leave && <InfoRow label="Freistellung" value="Ja" />}
          {rec.include_severance && <InfoRow label="Abfindung" value={`${rec.severance_amount.toFixed(2)} EUR`} />}
        </div>

        {/* Employee info */}
        <div className={`${ds.sectionLabel} mb-2`}>Mitarbeiter</div>
        <div className={`${ds.card} mb-4`}>
          <InfoRow label="Name" value={rec.employee_name} />
          <InfoRow label="Beschaeftigungsbeginn" value={formatDate(rec.employee_start_date)} />
          <InfoRow label="Betriebszugehoerigkeit" value={`${rec.tenure_years.toFixed(1)} Jahre`} />
          <InfoRow label="In Probezeit" value={rec.in_probation ? 'Ja' : 'Nein'} />
          {rec.employee_street && (
            <InfoRow label="Adresse" value={<>{rec.employee_street}<br />{rec.employee_zip} {rec.employee_city}</>} />
          )}
        </div>

        {/* Status / sending */}
        <div className={`${ds.sectionLabel} mb-2`}>Status</div>
        <div className={`${ds.card} mb-6`}>
          <InfoRow label="Signaturstatus" value={rec.sign_state === 'fully_signed' ? 'Vollstaendig' : rec.sign_state === 'employer_signed' ? 'AG unterschrieben' : 'Nicht gestartet'} />
          <InfoRow label="An Steuerberater" value={rec.sent_to_accountant ? `Gesendet (${formatDate(rec.sent_to_accountant_date)})` : 'Nicht gesendet'} />
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <button className={ds.btnPrimary} onClick={downloadPdf} disabled={pdfLoading}>
            {pdfLoading ? 'Wird generiert...' : 'PDF herunterladen'}
          </button>

          {!rec.sent_to_accountant && rec.state !== 'cancelled' && (
            <button className={ds.btnSecondary} onClick={() => setShowSendDialog(true)}>
              An Steuerberater senden
            </button>
          )}

          {(rec.state === 'draft' || rec.state === 'confirmed') && (
            <button className={ds.btnDanger} onClick={() => setShowCancelDialog(true)}>
              Stornieren
            </button>
          )}
        </div>
      </div>

      {/* Confirm dialogs — conditionally rendered (no open prop) */}
      {showSendDialog && (
        <ConfirmDialog
          title="An Steuerberater senden?"
          message={`KW-${rec.id} (${rec.employee_name}) wird per E-Mail an den Steuerberater gesendet.`}
          confirmLabel="Senden"
          onConfirm={sendToAccountant}
          onCancel={() => setShowSendDialog(false)}
        />
      )}
      {showCancelDialog && (
        <ConfirmDialog
          title="Kuendigung stornieren?"
          message={`KW-${rec.id} (${rec.employee_name}) wird unwiderruflich storniert.`}
          confirmLabel="Stornieren"
          variant="danger"
          onConfirm={cancelTermination}
          onCancel={() => setShowCancelDialog(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-5 py-3 rounded-xl text-[14px] font-medium shadow-lg z-[100]">
          {toast}
        </div>
      )}
    </>
  );
}
