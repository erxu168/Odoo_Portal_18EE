'use client';

import React, { useState, useEffect } from 'react';
import { TERMINATION_TYPE_LABELS, type TerminationType, type TerminationRecord } from '@/types/termination';

interface Employee {
  id: number;
  name: string;
  company_id: [number, string];
  department_id: [number, string] | false;
  job_title: string | false;
  private_street: string | false;
  private_city: string | false;
  private_zip: string | false;
}

interface TermWizardProps {
  onBack: () => void;
  onCreated: (id: number) => void;
  onHome: () => void;
}

type Step = 'employee' | 'type' | 'details' | 'review';

export default function TermWizard({ onBack, onCreated, onHome }: TermWizardProps) {
  // State
  const [step, setStep] = useState<Step>('employee');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Form values
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [termType, setTermType] = useState<TerminationType | ''>('');
  const [letterDate, setLetterDate] = useState(new Date().toISOString().split('T')[0]);
  const [calcMethod, setCalcMethod] = useState<'bgb' | 'receipt'>('bgb');
  const [receiptDate, setReceiptDate] = useState('');
  // Fristlose
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  // Aufhebung
  const [lastWorkingDayManual, setLastWorkingDayManual] = useState('');
  const [includeSeverance, setIncludeSeverance] = useState(false);
  const [severanceAmount, setSeveranceAmount] = useState('');
  const [gardenLeave, setGardenLeave] = useState(false);
  // Bestaetigung
  const [resignationDate, setResignationDate] = useState('');
  // Preview (from server after create)
  const [preview, setPreview] = useState<TerminationRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/termination/employees');
        const json = await res.json();
        setEmployees(json.data || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const filteredEmployees = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()),
  );

  const termTypes: { value: TerminationType; label: string; desc: string }[] = [
    { value: 'ordentlich', label: 'Ordentliche K\u00fcndigung', desc: 'Mit gesetzlicher Frist (\u00a7622 BGB)' },
    { value: 'ordentlich_probezeit', label: 'K\u00fcndigung (Probezeit)', desc: '2 Wochen Frist' },
    { value: 'fristlos', label: 'Fristlose K\u00fcndigung', desc: 'Sofortige Wirkung (\u00a7626 BGB)' },
    { value: 'aufhebung', label: 'Aufhebungsvertrag', desc: 'Einvernehmliche Beendigung' },
    { value: 'bestaetigung', label: 'K\u00fcndigungsbest\u00e4tigung', desc: 'Mitarbeiter hat gek\u00fcndigt' },
  ];

  async function handleSubmit() {
    if (!selectedEmployee || !termType) return;
    setSubmitting(true);
    setError('');

    try {
      const body: Record<string, unknown> = {
        employee_id: selectedEmployee.id,
        company_id: selectedEmployee.company_id[0],
        termination_type: termType,
        calc_method: calcMethod,
        letter_date: letterDate,
        employee_street: selectedEmployee.private_street || '',
        employee_city: selectedEmployee.private_city || '',
        employee_zip: selectedEmployee.private_zip || '',
      };
      if (receiptDate) body.receipt_date = receiptDate;
      if (termType === 'fristlos') {
        if (incidentDate) body.incident_date = incidentDate;
        if (incidentDescription) body.incident_description = incidentDescription;
      }
      if (termType === 'aufhebung') {
        if (lastWorkingDayManual) body.last_working_day = lastWorkingDayManual;
        body.include_severance = includeSeverance;
        if (includeSeverance && severanceAmount) body.severance_amount = parseFloat(severanceAmount);
        body.garden_leave = gardenLeave;
      }
      if (termType === 'bestaetigung' && resignationDate) {
        body.resignation_received_date = resignationDate;
      }

      const res = await fetch('/api/termination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Fehler beim Erstellen');

      setPreview(json.data);
      setStep('review');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmAndGeneratePdf() {
    if (!preview) return;
    setSubmitting(true);
    setError('');

    try {
      // Confirm the record
      const confirmRes = await fetch(`/api/termination/${preview.id}/confirm`, { method: 'POST' });
      const confirmJson = await confirmRes.json();
      if (!confirmJson.ok) throw new Error(confirmJson.error || 'Fehler beim Best\u00e4tigen');

      // Generate PDF
      const pdfRes = await fetch(`/api/termination/${preview.id}/pdf`, { method: 'POST' });
      if (!pdfRes.ok) {
        const pdfJson = await pdfRes.json();
        throw new Error(pdfJson.error || 'PDF-Erstellung fehlgeschlagen');
      }

      // Open PDF in new tab
      const pdfBlob = await pdfRes.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, '_blank');

      onCreated(preview.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // --- Step renderers ---

  function renderStepEmployee() {
    return (
      <>
        <div className="mb-4">
          <input
            type="text" placeholder="Mitarbeiter suchen..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30"
            autoFocus
          />
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredEmployees.map(emp => (
              <button
                key={emp.id}
                onClick={() => { setSelectedEmployee(emp); setStep('type'); }}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  selectedEmployee?.id === emp.id
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 bg-white active:bg-gray-50'
                }`}
              >
                <div className="text-[14px] font-semibold text-gray-900">{emp.name}</div>
                <div className="text-[12px] text-gray-500 mt-0.5">
                  {emp.department_id ? emp.department_id[1] : ''}
                  {emp.job_title ? ` \u2022 ${emp.job_title}` : ''}
                  {emp.company_id ? ` \u2022 ${emp.company_id[1]}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  function renderStepType() {
    return (
      <div className="space-y-2">
        {termTypes.map(t => (
          <button
            key={t.value}
            onClick={() => { setTermType(t.value); setStep('details'); }}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${
              termType === t.value
                ? 'border-red-400 bg-red-50'
                : 'border-gray-200 bg-white active:bg-gray-50'
            }`}
          >
            <div className="text-[14px] font-semibold text-gray-900">{t.label}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>
    );
  }

  function renderStepDetails() {
    const showCalcMethod = termType === 'ordentlich' || termType === 'ordentlich_probezeit';
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-[12px] text-gray-500 mb-1">Mitarbeiter</div>
          <div className="text-[14px] font-semibold">{selectedEmployee?.name}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-[12px] text-gray-500 mb-1">Art</div>
          <div className="text-[14px] font-semibold">{termType ? TERMINATION_TYPE_LABELS[termType] : ''}</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="block">
            <span className="text-[12px] text-gray-500">Datum des Schreibens</span>
            <input type="date" value={letterDate} onChange={e => setLetterDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
          </label>

          {showCalcMethod && (
            <label className="block">
              <span className="text-[12px] text-gray-500">Berechnungsmethode</span>
              <select value={calcMethod} onChange={e => setCalcMethod(e.target.value as 'bgb' | 'receipt')}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none">
                <option value="bgb">\u00a7 622 BGB gesetzlich</option>
                <option value="receipt">Ab Zugang</option>
              </select>
            </label>
          )}

          {showCalcMethod && calcMethod === 'receipt' && (
            <label className="block">
              <span className="text-[12px] text-gray-500">Zugangsdatum</span>
              <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
            </label>
          )}

          {termType === 'fristlos' && (
            <>
              <label className="block">
                <span className="text-[12px] text-gray-500">Datum des Vorfalls</span>
                <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </label>
              <label className="block">
                <span className="text-[12px] text-gray-500">Beschreibung (intern)</span>
                <textarea value={incidentDescription} onChange={e => setIncidentDescription(e.target.value)}
                  rows={3} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </label>
            </>
          )}

          {termType === 'aufhebung' && (
            <>
              <label className="block">
                <span className="text-[12px] text-gray-500">Letzter Arbeitstag</span>
                <input type="date" value={lastWorkingDayManual} onChange={e => setLastWorkingDayManual(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={gardenLeave} onChange={e => setGardenLeave(e.target.checked)} className="w-5 h-5 rounded" />
                <span className="text-[14px]">Freistellung</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={includeSeverance} onChange={e => setIncludeSeverance(e.target.checked)} className="w-5 h-5 rounded" />
                <span className="text-[14px]">Abfindung</span>
              </label>
              {includeSeverance && (
                <label className="block">
                  <span className="text-[12px] text-gray-500">Abfindungsbetrag (EUR)</span>
                  <input type="number" step="0.01" value={severanceAmount} onChange={e => setSeveranceAmount(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                </label>
              )}
            </>
          )}

          {termType === 'bestaetigung' && (
            <label className="block">
              <span className="text-[12px] text-gray-500">K\u00fcndigung erhalten am</span>
              <input type="date" value={resignationDate} onChange={e => setResignationDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
            </label>
          )}
        </div>

        {error && <div className="bg-red-50 text-red-700 text-[13px] px-4 py-3 rounded-xl">{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-[15px] active:bg-red-700 disabled:opacity-50"
        >
          {submitting ? 'Erstelle...' : 'K\u00fcndigung erstellen'}
        </button>
      </div>
    );
  }

  function renderStepReview() {
    if (!preview) return null;
    const formatDate = (d: string | false) => {
      if (!d) return '---';
      const [y, m, day] = d.split('-');
      return `${day}.${m}.${y}`;
    };
    return (
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <div className="text-green-700 font-semibold text-[15px]">K\u00fcndigung erstellt</div>
          <div className="text-green-600 text-[12px] mt-1">KW-{preview.id}</div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Mitarbeiter</span><span className="text-[14px] font-medium">{preview.employee_name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Art</span><span className="text-[14px] font-medium">{TERMINATION_TYPE_LABELS[preview.termination_type]}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">K\u00fcndigungsfrist</span><span className="text-[14px] font-medium">{preview.notice_period_text}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Letzter Arbeitstag</span><span className="text-[14px] font-bold text-red-600">{formatDate(preview.last_working_day)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Datum</span><span className="text-[14px]">{formatDate(preview.letter_date)}</span></div>
        </div>

        {error && <div className="bg-red-50 text-red-700 text-[13px] px-4 py-3 rounded-xl">{error}</div>}

        <button
          onClick={handleConfirmAndGeneratePdf}
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-red-600 text-white font-semibold text-[15px] active:bg-red-700 disabled:opacity-50"
        >
          {submitting ? 'Erstelle PDF...' : 'Best\u00e4tigen & PDF erstellen'}
        </button>

        <button
          onClick={onBack}
          className="w-full py-3 rounded-xl bg-gray-100 text-gray-700 font-medium text-[14px] active:bg-gray-200"
        >
          Zur\u00fcck zum Dashboard
        </button>
      </div>
    );
  }

  // --- Layout ---

  const stepLabels: Record<Step, string> = {
    employee: '1. Mitarbeiter',
    type: '2. Art',
    details: '3. Details',
    review: '4. \u00dcberpr\u00fcfung',
  };

  return (
    <div>
      <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={step === 'employee' ? onBack : () => {
            if (step === 'type') setStep('employee');
            else if (step === 'details') setStep('type');
            else if (step === 'review') setStep('details');
          }} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Neue K\u00fcndigung</h1>
            <p className="text-[12px] text-white/60 mt-0.5">{stepLabels[step]}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
        </div>
        {/* Step indicator */}
        <div className="flex gap-1 mt-3">
          {(['employee', 'type', 'details', 'review'] as Step[]).map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${
              i <= ['employee', 'type', 'details', 'review'].indexOf(step)
                ? 'bg-white'
                : 'bg-white/20'
            }`} />
          ))}
        </div>
      </div>

      <div className="px-4 py-4">
        {step === 'employee' && renderStepEmployee()}
        {step === 'type' && renderStepType()}
        {step === 'details' && renderStepDetails()}
        {step === 'review' && renderStepReview()}
      </div>
    </div>
  );
}
