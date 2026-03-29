'use client';

import React, { useState, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { TERMINATION_TYPE_LABELS } from '@/types/termination';
import type { TerminationType, TerminationCreateValues } from '@/types/termination';

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

interface Props {
  onBack: () => void;
  onHome: () => void;
  onCreated: (id: number) => void;
}

const TYPES: { value: TerminationType; label: string }[] = [
  { value: 'ordentlich', label: 'Ordentliche K\u00fcndigung' },
  { value: 'ordentlich_probezeit', label: 'Ordentliche K\u00fcndigung (Probezeit)' },
  { value: 'fristlos', label: 'Fristlose K\u00fcndigung' },
  { value: 'aufhebung', label: 'Aufhebungsvertrag' },
  { value: 'bestaetigung', label: 'K\u00fcndigungsbest\u00e4tigung' },
];

export default function NewTermination({ onBack, onHome, onCreated }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [termType, setTermType] = useState<TerminationType | ''>('');
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10));
  const [lastDay, setLastDay] = useState('');
  const [noticePeriod, setNoticePeriod] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'employee' | 'type' | 'review'>('employee');
  const [error, setError] = useState('');
  // Aufhebung extra fields
  const [aufhebungDate, setAufhebungDate] = useState('');
  const [severance, setSeverance] = useState(false);
  const [severanceAmount, setSeveranceAmount] = useState('');
  const [gardenLeave, setGardenLeave] = useState(false);
  // Fristlos extra
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');
  // Bestaetigung extra
  const [resignDate, setResignDate] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/termination/employees');
        const data = await res.json();
        if (data.ok) setEmployees(data.data || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  // When type is selected, create a temp record to get computed dates
  async function computeDates(type: TerminationType) {
    if (!selectedEmp) return;
    try {
      const body: TerminationCreateValues = {
        employee_id: selectedEmp.id,
        company_id: selectedEmp.company_id[0],
        termination_type: type,
        letter_date: letterDate,
      };
      // Create a draft record to get computed fields
      const res = await fetch('/api/termination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        const rec = data.data;
        setLastDay(rec.last_working_day || '');
        setNoticePeriod(rec.notice_period_text || '');
        return rec.id;
      }
    } catch { /* ignore */ }
    return null;
  }

  const [draftId, setDraftId] = useState<number | null>(null);

  async function handleTypeSelect(type: TerminationType) {
    setTermType(type);
    setError('');
    const id = await computeDates(type);
    if (id) setDraftId(id);
    setStep('review');
  }

  async function handleConfirm() {
    if (!draftId) return;
    setSubmitting(true);
    setError('');
    try {
      // Update extra fields if needed
      const updates: Record<string, unknown> = {};
      if (termType === 'aufhebung' && aufhebungDate) updates.last_working_day = aufhebungDate;
      if (termType === 'aufhebung') {
        updates.include_severance = severance;
        if (severance) updates.severance_amount = parseFloat(severanceAmount) || 0;
        updates.garden_leave = gardenLeave;
      }
      if (termType === 'fristlos') {
        if (incidentDate) updates.incident_date = incidentDate;
        if (incidentDesc) updates.incident_description = incidentDesc;
      }
      if (termType === 'bestaetigung' && resignDate) {
        updates.resignation_received_date = resignDate;
      }

      if (Object.keys(updates).length > 0) {
        await fetch(`/api/termination/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
      }

      // Confirm
      const res = await fetch(`/api/termination/${draftId}/confirm`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        onCreated(draftId);
      } else {
        setError(data.error || 'Fehler beim Best\u00e4tigen');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredEmps = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  if (step === 'employee') {
    return (
      <>
        <AppHeader title="Neue K\u00fcndigung" subtitle="Mitarbeiter w\u00e4hlen" showBack onBack={onBack} />
        <div className="px-4 py-3">
          <input
            type="text"
            placeholder="Mitarbeiter suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
        </div>
        <div className="px-4 pb-20">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-7 h-7 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {filteredEmps.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => { setSelectedEmp(emp); setStep('type'); }}
                  className="w-full text-left bg-white rounded-xl border border-gray-100 px-4 py-3 active:bg-gray-50 transition-colors"
                >
                  <div className="font-semibold text-gray-900">{emp.name}</div>
                  <div className="text-xs text-gray-500">
                    {emp.company_id[1]}
                    {emp.department_id ? ` \u2022 ${emp.department_id[1]}` : ''}
                    {emp.job_title ? ` \u2022 ${emp.job_title}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  if (step === 'type') {
    return (
      <>
        <AppHeader title={selectedEmp?.name || ''} subtitle="Art der K\u00fcndigung w\u00e4hlen" showBack onBack={() => setStep('employee')} />
        <div className="px-4 py-4">
          <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Datum des Schreibens</label>
          <input
            type="date"
            value={letterDate}
            onChange={e => setLetterDate(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm mb-4"
          />
        </div>
        <div className="px-4 pb-20 space-y-2">
          {TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => handleTypeSelect(t.value)}
              className="w-full text-left bg-white rounded-xl border border-gray-100 px-4 py-4 active:bg-gray-50 transition-colors shadow-sm"
            >
              <div className="font-semibold text-gray-900">{t.label}</div>
            </button>
          ))}
        </div>
      </>
    );
  }

  // Review step
  return (
    <>
      <AppHeader title="\u00dcberpr\u00fcfung" subtitle={selectedEmp?.name || ''} showBack onBack={() => setStep('type')} />
      <div className="px-4 py-4 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Zusammenfassung</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Mitarbeiter</span><span className="font-medium">{selectedEmp?.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Unternehmen</span><span className="font-medium">{selectedEmp?.company_id[1]}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Art</span><span className="font-medium">{TERMINATION_TYPE_LABELS[termType as TerminationType]}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Datum</span><span className="font-medium">{letterDate}</span></div>
            {noticePeriod && <div className="flex justify-between"><span className="text-gray-500">K\u00fcndigungsfrist</span><span className="font-medium">{noticePeriod}</span></div>}
            {lastDay && <div className="flex justify-between"><span className="text-gray-500">Letzter Arbeitstag</span><span className="font-bold text-red-600">{lastDay}</span></div>}
          </div>
        </div>

        {termType === 'aufhebung' && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase">Aufhebungsvertrag Details</div>
            <div>
              <label className="text-xs text-gray-500">Beendigungsdatum</label>
              <input type="date" value={aufhebungDate} onChange={e => setAufhebungDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={gardenLeave} onChange={e => setGardenLeave(e.target.checked)} className="rounded" />
              <span className="text-sm">Freistellung</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={severance} onChange={e => setSeverance(e.target.checked)} className="rounded" />
              <span className="text-sm">Abfindung</span>
            </label>
            {severance && (
              <input type="number" placeholder="Betrag (EUR)" value={severanceAmount}
                onChange={e => setSeveranceAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            )}
          </div>
        )}

        {termType === 'fristlos' && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase">Vorfall</div>
            <div>
              <label className="text-xs text-gray-500">Datum des Vorfalls</label>
              <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Beschreibung (intern)</label>
              <textarea value={incidentDesc} onChange={e => setIncidentDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" rows={3} />
            </div>
          </div>
        )}

        {termType === 'bestaetigung' && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
            <div className="text-xs font-semibold text-gray-400 uppercase">Eigene K\u00fcndigung</div>
            <div>
              <label className="text-xs text-gray-500">K\u00fcndigung erhalten am</label>
              <input type="date" value={resignDate} onChange={e => setResignDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" />
            </div>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full py-3.5 rounded-xl bg-red-600 text-white font-bold text-sm active:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Wird erstellt...' : 'K\u00fcndigung best\u00e4tigen'}
        </button>
      </div>
    </>
  );
}
